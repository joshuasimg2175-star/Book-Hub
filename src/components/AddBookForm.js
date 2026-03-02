import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getBookByISBN, searchMangaByTitle, toShortSummary } from '../services/googleBooksAPI';

const QUAGGA_SCRIPT_ID = 'quagga2-cdn-script';
const QUAGGA_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.8.4/dist/quagga.js';
const SCAN_BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
const SCAN_READERS = ['ean_reader', 'ean_8_reader', 'upc_reader', 'upc_e_reader', 'code_128_reader'];
const LIVE_SCAN_FRAME_INTERVAL_MS = 180;
const LIVE_SCAN_REQUIRED_STREAK = 2;
const SCAN_CATEGORY_OPTIONS = [
  { value: 'read', label: 'Finished' },
  { value: 'currently reading', label: 'Currently Reading' },
  { value: 'unread', label: "Didn't Finish" },
  { value: 'wishlist', label: 'Wishlist' }
];

const AddBookForm = ({ onBookAdd, isExpanded = true }) => {
  const [activeTab, setActiveTab] = useState('isbn');
  const [isbn, setIsbn] = useState('');
  const [manualBook, setManualBook] = useState({
    title: '',
    authors: '',
    summary: '',
    cover: ''
  });
  const [isScanning, setIsScanning] = useState(false);
  const [isResolvingScan, setIsResolvingScan] = useState(false);
  const [isPhotoScanning, setIsPhotoScanning] = useState(false);
  const [isFrameScanning, setIsFrameScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [detectedCode, setDetectedCode] = useState('');
  const [manualScanCode, setManualScanCode] = useState('');
  const [mangaQuery, setMangaQuery] = useState('');
  const [mangaResults, setMangaResults] = useState([]);
  const [mangaStatus, setMangaStatus] = useState('unread');
  const [mangaMeta, setMangaMeta] = useState({ volume: '', chapter: '', arcTags: '' });
  const [isMangaSearching, setIsMangaSearching] = useState(false);
  const [mangaError, setMangaError] = useState('');
  const [mangaNotice, setMangaNotice] = useState(null);
  const [pendingScannedBook, setPendingScannedBook] = useState(null);
  const [scanPopup, setScanPopup] = useState({ isOpen: false, type: 'success', title: '', message: '' });
  const [scannerMode, setScannerMode] = useState(null);
  const videoRef = useRef(null);
  const quaggaContainerRef = useRef(null);
  const photoInputRef = useRef(null);
  const scannerStreamRef = useRef(null);
  const detectorRef = useRef(null);
  const scannerFrameRef = useRef(null);
  const quaggaOnDetectedRef = useRef(null);
  const quaggaScriptPromiseRef = useRef(null);
  const isScanningRef = useRef(false);
  const isHandlingDetectionRef = useRef(false);
  const scanPopupTimerRef = useRef(null);
  const lastDetectTsRef = useRef(0);
  const liveDetectErrorCountRef = useRef(0);
  const liveDetectStreakRef = useRef({ code: '', count: 0 });

  const tabIndex = useMemo(() => ({ isbn: 0, manual: 1, scan: 2, manga: 3 }[activeTab] ?? 0), [activeTab]);
  const tabCount = 4;
  const hasModernCameraApi = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const hasLegacyCameraApi = typeof navigator !== 'undefined' && typeof (
    navigator.getUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia ||
    navigator.msGetUserMedia
  ) === 'function';
  const hasBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  const canUseCamera = hasModernCameraApi || hasLegacyCameraApi;
  const canUseBarcodeDetector = hasBarcodeDetector && canUseCamera;
  const canUseLiveScanner = canUseCamera;
  const canUseBrowserNotifications = typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;

  useEffect(() => {
    if (activeTab !== 'scan') {
      stopScanner();
      setPendingScannedBook(null);
    }
    return () => stopScanner();
  }, [activeTab]);

  useEffect(() => {
    if (isExpanded) return;
    stopScanner();
    setPendingScannedBook(null);
    setIsResolvingScan(false);
    setIsPhotoScanning(false);
  }, [isExpanded]);

  useEffect(() => () => {
    if (scanPopupTimerRef.current) {
      clearTimeout(scanPopupTimerRef.current);
      scanPopupTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!mangaNotice) return undefined;
    const timer = window.setTimeout(() => setMangaNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [mangaNotice]);

  const normalizeBookCode = (code) => {
    const cleanedCode = (code || '').toUpperCase().replace(/[^0-9X]/g, '');
    if (!cleanedCode) return '';

    if (/^\d{14}$/.test(cleanedCode) && cleanedCode.startsWith('0')) {
      return cleanedCode.slice(1);
    }

    if (/^\d{13}$/.test(cleanedCode) || /^\d{12}$/.test(cleanedCode) || /^\d{9}[\dX]$/.test(cleanedCode)) {
      return cleanedCode;
    }

    const isbn13Match = cleanedCode.match(/97[89]\d{10}/);
    if (isbn13Match?.[0]) return isbn13Match[0];

    const upcMatch = cleanedCode.match(/\d{12}/);
    if (upcMatch?.[0]) return upcMatch[0];

    const isbn10Match = cleanedCode.match(/\d{9}[\dX]/);
    if (isbn10Match?.[0]) return isbn10Match[0];

    const digitsOnly = cleanedCode.replace(/X/g, '');
    if (digitsOnly.length >= 13) {
      return digitsOnly.slice(0, 13);
    }

    return cleanedCode;
  };

  const normalizeMangaProgress = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return '';
    return parsed;
  };

  const normalizeArcTags = (value) => {
    const tags = Array.isArray(value)
      ? value
      : String(value || '').split(',');
    return [...new Set(tags.map((tag) => String(tag || '').trim()).filter(Boolean))];
  };

  const showScanPopup = (type, title, message) => {
    const showInlinePopupFallback = () => {
      if (scanPopupTimerRef.current) {
        clearTimeout(scanPopupTimerRef.current);
        scanPopupTimerRef.current = null;
      }

      setScanPopup({ isOpen: true, type, title, message });
      scanPopupTimerRef.current = setTimeout(() => {
        setScanPopup((previousPopup) => ({ ...previousPopup, isOpen: false }));
        scanPopupTimerRef.current = null;
      }, 3200);
    };

    if (!canUseBrowserNotifications) {
      showInlinePopupFallback();
      return;
    }

    const notifyInBrowser = async () => {
      try {
        let permission = Notification.permission;
        if (permission === 'default') {
          permission = await Notification.requestPermission();
        }

        if (permission !== 'granted') {
          showInlinePopupFallback();
          return;
        }

        const notification = new Notification(title, {
          body: message,
          tag: `scan-result-${type}`,
          renotify: true,
          icon: '/logo192.png',
          badge: '/logo192.png'
        });
        notification.onclick = () => window.focus();
        window.setTimeout(() => notification.close(), 4200);
      } catch {
        showInlinePopupFallback();
      }
    };

    void notifyInBrowser();
  };

  const primeNotificationPermission = () => {
    if (!canUseBrowserNotifications) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {
        // no-op
      });
    }
  };

  const dismissScanPopup = () => {
    if (scanPopupTimerRef.current) {
      clearTimeout(scanPopupTimerRef.current);
      scanPopupTimerRef.current = null;
    }
    setScanPopup((previousPopup) => ({ ...previousPopup, isOpen: false }));
  };

  const normalizeBookPayload = (book, status = 'unread', mangaMetaOverride = null) => {
    const normalizedSummary = toShortSummary(book?.summary || book?.description || '');
    const normalizedAuthors = Array.isArray(book?.authors)
      ? book.authors.filter(Boolean)
      : [book?.authors].filter(Boolean);
    const mediaType = String(book?.mediaType || '').trim().toLowerCase() === 'manga' ? 'manga' : 'book';
    const mangaVolume =
      mediaType === 'manga'
        ? normalizeMangaProgress(
          mangaMetaOverride?.volume ??
            mangaMetaOverride?.mangaVolume ??
            book?.mangaVolume ??
            book?.volume
        )
        : '';
    const mangaChapter =
      mediaType === 'manga'
        ? normalizeMangaProgress(
          mangaMetaOverride?.chapter ??
            mangaMetaOverride?.mangaChapter ??
            book?.mangaChapter ??
            book?.chapter
        )
        : '';
    const arcTags =
      mediaType === 'manga'
        ? normalizeArcTags(mangaMetaOverride?.arcTags ?? book?.arcTags ?? book?.arcs)
        : [];

    return {
      ...book,
      authors: normalizedAuthors.length > 0 ? normalizedAuthors : ['Unknown Author'],
      summary: normalizedSummary,
      description: normalizedSummary,
      mediaType,
      seriesType: String(book?.seriesType || '').trim(),
      mangaVolume,
      mangaChapter,
      arcTags,
      status
    };
  };

  const fetchBookByCode = async (rawCode, { showAlert = true } = {}) => {
    const cleanedCode = normalizeBookCode(rawCode);
    if (!cleanedCode) {
      return null;
    }

    try {
      const book = await getBookByISBN(cleanedCode);
      if (book) {
        return normalizeBookPayload(book);
      }
      if (showAlert) {
        alert('Book not found for that ISBN/barcode.');
      }
      return null;
    } catch (error) {
      if (showAlert) {
        alert('Failed to fetch book data. Please check your network connection.');
      }
      return null;
    }
  };

  const addBookFromCode = async (rawCode, { showAlert = true, status = 'unread' } = {}) => {
    const book = await fetchBookByCode(rawCode, { showAlert });
    if (!book) return false;

    onBookAdd(normalizeBookPayload(book, status));
    setIsbn('');
    return true;
  };

  const queueScannedBookForCategory = (book, scannedCode, formatLabel = '') => {
    setPendingScannedBook({
      ...normalizeBookPayload(book),
      scannedCode,
      scannedFormat: formatLabel
    });
  };

  const handleScannedCategorySelect = (status) => {
    if (!pendingScannedBook) return;

    const categoryLabel = SCAN_CATEGORY_OPTIONS.find((option) => option.value === status)?.label || 'Selected Category';
    onBookAdd(normalizeBookPayload(pendingScannedBook, status));
    setPendingScannedBook(null);
    showScanPopup('success', 'Book Added', `Added to ${categoryLabel}.`);
  };

  const handleDetectedCode = async (code, formatLabel = '') => {
    const cleanedCode = normalizeBookCode(code);
    if (!cleanedCode) return;

    setDetectedCode(formatLabel ? `${cleanedCode} (${formatLabel})` : cleanedCode);
    setScanError('');
    setIsResolvingScan(true);

    const scannedBook = await fetchBookByCode(cleanedCode, { showAlert: false });
    if (!scannedBook) {
      setScanError('Barcode detected, but no book metadata was found. Try manual code entry below.');
      showScanPopup('error', 'Scan Failed', 'Barcode detected, but no matching book details were found.');
    } else {
      queueScannedBookForCategory(scannedBook, cleanedCode, formatLabel);
      showScanPopup('success', 'Book Found', 'Choose where to categorize this book.');
    }
    setIsResolvingScan(false);
  };

  const handleIsbnSubmit = async (e) => {
    e.preventDefault();
    if (!isbn) return;
    await addBookFromCode(isbn);
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manualBook.title) return;

    const book = {
      ...manualBook,
      authors: manualBook.authors.split(',').map(a => a.trim()),
      status: 'unread'
    };
    onBookAdd(normalizeBookPayload(book, 'unread'));
    setManualBook({ title: '', authors: '', summary: '', cover: '' });
  };

  const handleMangaSearch = async (event) => {
    event.preventDefault();
    const trimmedQuery = String(mangaQuery || '').trim();
    if (trimmedQuery.length < 2) {
      setMangaError('Enter at least 2 characters to search manga.');
      setMangaResults([]);
      return;
    }

    setIsMangaSearching(true);
    setMangaError('');
    setMangaNotice(null);

    try {
      const results = await searchMangaByTitle(trimmedQuery);
      setMangaResults(results);
      if (!results.length) {
        setMangaError('No manga matches were found. Try a different title.');
      }
    } catch {
      setMangaResults([]);
      setMangaError('Manga search failed. Please check your network and try again.');
    } finally {
      setIsMangaSearching(false);
    }
  };

  const handleAddMangaResult = (manga) => {
    if (!manga || typeof manga !== 'object') return;
    const selectedCategoryLabel =
      SCAN_CATEGORY_OPTIONS.find((option) => option.value === mangaStatus)?.label || 'Selected Category';
    onBookAdd(normalizeBookPayload({ ...manga, mediaType: 'manga' }, mangaStatus, mangaMeta));
    setMangaNotice({ type: 'success', text: `"${manga.title}" added to ${selectedCategoryLabel}.` });
  };

  const stopScanner = () => {
    isScanningRef.current = false;
    lastDetectTsRef.current = 0;
    liveDetectErrorCountRef.current = 0;
    liveDetectStreakRef.current = { code: '', count: 0 };

    if (scannerFrameRef.current) {
      cancelAnimationFrame(scannerFrameRef.current);
      scannerFrameRef.current = null;
    }

    if (typeof window !== 'undefined' && window.Quagga) {
      if (quaggaOnDetectedRef.current) {
        window.Quagga.offDetected(quaggaOnDetectedRef.current);
        quaggaOnDetectedRef.current = null;
      }
      try {
        window.Quagga.stop();
      } catch {
        // ignore teardown errors
      }
    }

    if (scannerStreamRef.current) {
      scannerStreamRef.current.getTracks().forEach((track) => track.stop());
      scannerStreamRef.current = null;
    }

    detectorRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (quaggaContainerRef.current) {
      quaggaContainerRef.current.innerHTML = '';
    }

    setScannerMode(null);
    setIsScanning(false);
    setIsFrameScanning(false);
  };

  const loadQuaggaFromCdn = async () => {
    if (typeof window === 'undefined') return null;
    if (window.Quagga) return window.Quagga;

    if (!quaggaScriptPromiseRef.current) {
      quaggaScriptPromiseRef.current = new Promise((resolve, reject) => {
        const existingScript = document.getElementById(QUAGGA_SCRIPT_ID);
        if (existingScript) {
          existingScript.addEventListener('load', () => resolve(window.Quagga));
          existingScript.addEventListener('error', () => reject(new Error('Failed to load scanner library.')));
          return;
        }

        const script = document.createElement('script');
        script.id = QUAGGA_SCRIPT_ID;
        script.src = QUAGGA_SCRIPT_URL;
        script.async = true;
        script.onload = () => resolve(window.Quagga);
        script.onerror = () => reject(new Error('Failed to load scanner library.'));
        document.body.appendChild(script);
      });
    }

    return quaggaScriptPromiseRef.current;
  };

  const startQuaggaScanner = async () => {
    const Quagga = await loadQuaggaFromCdn();
    if (!Quagga || !quaggaContainerRef.current) {
      throw new Error('Fallback scanner not available.');
    }

    quaggaContainerRef.current.innerHTML = '';

    await new Promise((resolve, reject) => {
      Quagga.init(
        {
          inputStream: {
            type: 'LiveStream',
            target: quaggaContainerRef.current,
            constraints: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            area: {
              top: '12%',
              right: '5%',
              left: '5%',
              bottom: '12%'
            }
          },
          locator: {
            patchSize: 'medium',
            halfSample: true
          },
          numOfWorkers: navigator.hardwareConcurrency ? Math.max(1, Math.min(4, navigator.hardwareConcurrency - 1)) : 2,
          frequency: 10,
          decoder: {
            readers: SCAN_READERS
          },
          locate: true
        },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });

    Quagga.start();
    setScannerMode('quagga');
    isScanningRef.current = true;
    setIsScanning(true);
    quaggaOnDetectedRef.current = async (result) => {
      const foundCode = normalizeBookCode(result?.codeResult?.code || '');
      if (!foundCode || isHandlingDetectionRef.current) return;
      isHandlingDetectionRef.current = true;
      stopScanner();
      await handleDetectedCode(foundCode, result?.codeResult?.format || 'barcode');
      isHandlingDetectionRef.current = false;
    };
    Quagga.onDetected(quaggaOnDetectedRef.current);
  };

  const selectPreferredDetectedCode = (barcodes) => {
    if (!Array.isArray(barcodes) || barcodes.length === 0) return null;
    const preferred = barcodes.find((barcode) => SCAN_BARCODE_FORMATS.includes((barcode?.format || '').toLowerCase()));
    return preferred || barcodes[0];
  };

  const loadImageElementFromFile = async (file) => {
    const objectUrl = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Unable to load the selected image.'));
      };
      img.src = objectUrl;
    });
  };

  const enhanceForBarcode = (ctx, width, height, { contrast = 1.35, threshold = 0 } = {}) => {
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;

    for (let index = 0; index < pixels.length; index += 4) {
      const gray = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
      const contrasted = Math.max(0, Math.min(255, ((gray / 255 - 0.5) * contrast + 0.5) * 255));
      const adjusted = threshold > 0 ? (contrasted >= threshold ? 255 : 0) : contrasted;
      pixels[index] = adjusted;
      pixels[index + 1] = adjusted;
      pixels[index + 2] = adjusted;
    }

    ctx.putImageData(imageData, 0, 0);
  };

  const buildScanVariantsFromSource = (source, sourceWidth, sourceHeight, labelPrefix = 'source') => {
    if (!sourceWidth || !sourceHeight) {
      throw new Error('Image dimensions are invalid.');
    }

    const makeVariant = (label, crop, maxWidth, enhanceOptions = null) => {
      const scale = Math.min(1, maxWidth / crop.width);
      const width = Math.max(1, Math.round(crop.width * scale));
      const height = Math.max(1, Math.round(crop.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext('2d', { willReadFrequently: Boolean(enhanceOptions) });
      if (!context) return null;

      context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
      if (enhanceOptions) {
        enhanceForBarcode(context, width, height, enhanceOptions);
      }

      return {
        label,
        canvas,
        src: canvas.toDataURL('image/jpeg', 0.94)
      };
    };

    const centerBandHeight = Math.max(140, Math.round(sourceHeight * 0.45));
    const centerBandTop = Math.max(0, Math.round((sourceHeight - centerBandHeight) / 2));
    const wideBandHeight = Math.max(180, Math.round(sourceHeight * 0.65));
    const wideBandTop = Math.max(0, Math.round((sourceHeight - wideBandHeight) / 2));
    const topBandHeight = Math.max(130, Math.round(sourceHeight * 0.34));
    const bottomBandTop = Math.max(0, sourceHeight - topBandHeight);
    const halfWidth = Math.max(120, Math.round(sourceWidth * 0.52));
    const rightHalfLeft = Math.max(0, sourceWidth - halfWidth);

    return [
      makeVariant(`${labelPrefix}-full-large`, { x: 0, y: 0, width: sourceWidth, height: sourceHeight }, 1800),
      makeVariant(`${labelPrefix}-center-band`, { x: 0, y: centerBandTop, width: sourceWidth, height: centerBandHeight }, 1500),
      makeVariant(`${labelPrefix}-wide-band`, { x: 0, y: wideBandTop, width: sourceWidth, height: wideBandHeight }, 1300),
      makeVariant(`${labelPrefix}-top-band`, { x: 0, y: 0, width: sourceWidth, height: topBandHeight }, 1200),
      makeVariant(`${labelPrefix}-bottom-band`, { x: 0, y: bottomBandTop, width: sourceWidth, height: topBandHeight }, 1200),
      makeVariant(`${labelPrefix}-left-half`, { x: 0, y: 0, width: halfWidth, height: sourceHeight }, 1200),
      makeVariant(`${labelPrefix}-right-half`, { x: rightHalfLeft, y: 0, width: halfWidth, height: sourceHeight }, 1200),
      makeVariant(`${labelPrefix}-center-enhanced`, { x: 0, y: centerBandTop, width: sourceWidth, height: centerBandHeight }, 1300, { contrast: 1.4 }),
      makeVariant(`${labelPrefix}-center-strong`, { x: 0, y: centerBandTop, width: sourceWidth, height: centerBandHeight }, 1300, { contrast: 1.8 }),
      makeVariant(`${labelPrefix}-center-threshold`, { x: 0, y: centerBandTop, width: sourceWidth, height: centerBandHeight }, 1200, { contrast: 1.6, threshold: 150 }),
      makeVariant(`${labelPrefix}-full-compact`, { x: 0, y: 0, width: sourceWidth, height: sourceHeight }, 1000)
    ].filter(Boolean);
  };

  const buildPhotoScanVariants = async (file) => {
    const image = await loadImageElementFromFile(file);
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    return buildScanVariantsFromSource(image, imageWidth, imageHeight, 'photo');
  };

  const detectBarcodeWithNativeFromVariants = async (variants) => {
    if (!hasBarcodeDetector || typeof window.BarcodeDetector !== 'function') {
      return null;
    }

    let detector;
    try {
      detector = new window.BarcodeDetector({ formats: SCAN_BARCODE_FORMATS });
    } catch {
      detector = new window.BarcodeDetector();
    }

    for (const variant of variants) {
      try {
        const detectedBarcodes = await detector.detect(variant.canvas);
        const preferredCode = selectPreferredDetectedCode(detectedBarcodes);
        const rawValue = preferredCode?.rawValue || '';
        const cleanedCode = normalizeBookCode(rawValue);
        if (cleanedCode) {
          return {
            code: cleanedCode,
            format: preferredCode?.format || variant.label
          };
        }
      } catch {
        // Keep trying other variants.
      }
    }

    return null;
  };

  const decodeWithQuaggaSingle = (Quagga, sourceImage, options) => (
    new Promise((resolve, reject) => {
      try {
        Quagga.decodeSingle(
          {
            src: sourceImage,
            inputStream: {
              size: options.size
            },
            locator: {
              patchSize: options.patchSize,
              halfSample: options.halfSample
            },
            numOfWorkers: 0,
            decoder: {
              readers: SCAN_READERS
            },
            locate: options.locate
          },
          (result) => {
            const cleanedCode = normalizeBookCode(result?.codeResult?.code || '');
            if (!cleanedCode) {
              resolve(null);
              return;
            }
            resolve({
              code: cleanedCode,
              format: result?.codeResult?.format || options.label || 'barcode-image'
            });
          }
        );
      } catch (error) {
        reject(error);
      }
    })
  );

  const decodeBarcodeFromImage = async (file) => {
    const variants = await buildPhotoScanVariants(file);
    const nativeResult = await detectBarcodeWithNativeFromVariants(variants);
    if (nativeResult?.code) {
      return nativeResult;
    }

    // When native detector exists but misses, avoid Quagga photo fallback here
    // because Safari/PWA can throw opaque cross-origin runtime errors from CDN workers.
    if (hasBarcodeDetector) return null;

    const Quagga = await loadQuaggaFromCdn();
    if (!Quagga || typeof Quagga.decodeSingle !== 'function') {
      return null;
    }

    const primaryVariant = variants[0];
    if (!primaryVariant?.src) return null;

    try {
      return await decodeWithQuaggaSingle(Quagga, primaryVariant.src, {
        label: 'quagga-large',
        patchSize: 'large',
        halfSample: true,
        locate: true,
        size: 1400
      });
    } catch {
      return null;
    }
  };

  const handlePhotoScanClick = () => {
    primeNotificationPermission();
    if (photoInputRef.current) {
      photoInputRef.current.click();
    }
  };

  const handlePhotoScanChange = async (event) => {
    const selectedFile = event.target.files?.[0];
    event.target.value = '';
    if (!selectedFile) return;

    setScanError('');
    setDetectedCode('');
    setIsPhotoScanning(true);

    try {
      const scanned = await decodeBarcodeFromImage(selectedFile);
      if (!scanned?.code) {
        setScanError('No barcode was detected in that photo. Try a sharper image with better lighting.');
        showScanPopup('error', 'Scan Failed', 'No barcode was detected in the selected photo.');
        return;
      }
      await handleDetectedCode(scanned.code, scanned.format);
    } catch {
      setScanError('Photo scan failed. You can still enter the barcode manually below.');
      showScanPopup('error', 'Scan Failed', 'Photo scan could not be completed. Please try again.');
    } finally {
      setIsPhotoScanning(false);
    }
  };

  const requestCameraStream = async () => {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      const insecureContextError = new Error('Live camera requires a secure context.');
      insecureContextError.code = 'insecure_context';
      throw insecureContextError;
    }

    const preferredConstraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    };

    if (navigator.mediaDevices?.getUserMedia) {
      try {
        return await navigator.mediaDevices.getUserMedia(preferredConstraints);
      } catch {
        try {
          return await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false
          });
        } catch {
          return navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          });
        }
      }
    }

    const legacyGetUserMedia = navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia ||
      navigator.msGetUserMedia;
    if (!legacyGetUserMedia) {
      throw new Error('No camera API available.');
    }

    return new Promise((resolve, reject) => {
      legacyGetUserMedia.call(navigator, { video: true, audio: false }, resolve, reject);
    });
  };

  const configureCameraTrack = async (stream) => {
    const [track] = stream?.getVideoTracks?.() || [];
    if (!track || typeof track.applyConstraints !== 'function') return;

    const capabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
    const advanced = [];

    if (Array.isArray(capabilities?.focusMode) && capabilities.focusMode.includes('continuous')) {
      advanced.push({ focusMode: 'continuous' });
    }

    if (advanced.length === 0) return;

    try {
      await track.applyConstraints({ advanced });
    } catch {
      // Ignore unsupported advanced constraints.
    }
  };

  const detectLoop = async () => {
    if (!videoRef.current || !detectorRef.current || !isScanningRef.current) return;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastDetectTsRef.current < LIVE_SCAN_FRAME_INTERVAL_MS) {
      scannerFrameRef.current = requestAnimationFrame(detectLoop);
      return;
    }
    lastDetectTsRef.current = now;

    try {
      const barcodes = await detectorRef.current.detect(videoRef.current);
      if (barcodes.length > 0) {
        const preferredBarcode = selectPreferredDetectedCode(barcodes);
        const foundCode = normalizeBookCode(preferredBarcode?.rawValue || '');
        if (foundCode) {
          if (liveDetectStreakRef.current.code === foundCode) {
            liveDetectStreakRef.current.count += 1;
          } else {
            liveDetectStreakRef.current = { code: foundCode, count: 1 };
          }

          if (liveDetectStreakRef.current.count < LIVE_SCAN_REQUIRED_STREAK || isHandlingDetectionRef.current) {
            scannerFrameRef.current = requestAnimationFrame(detectLoop);
            return;
          }

          isHandlingDetectionRef.current = true;
          stopScanner();
          await handleDetectedCode(foundCode, preferredBarcode.format);
          isHandlingDetectionRef.current = false;
          return;
        }
      }

      liveDetectStreakRef.current = { code: '', count: 0 };
      liveDetectErrorCountRef.current = 0;
    } catch {
      liveDetectErrorCountRef.current += 1;
      if (liveDetectErrorCountRef.current === 1 || liveDetectErrorCountRef.current % 16 === 0) {
        setScanError('Keep the barcode centered and steady for a second for better scan quality.');
      }
    }

    scannerFrameRef.current = requestAnimationFrame(detectLoop);
  };

  const scanCurrentFrame = async () => {
    if (!videoRef.current || isFrameScanning || isResolvingScan) return;

    const sourceVideo = videoRef.current;
    const width = sourceVideo.videoWidth || sourceVideo.clientWidth;
    const height = sourceVideo.videoHeight || sourceVideo.clientHeight;
    if (!width || !height) {
      setScanError('Camera is warming up. Try Capture Frame again in a moment.');
      return;
    }

    setIsFrameScanning(true);
    setScanError('');

    try {
      const variants = buildScanVariantsFromSource(sourceVideo, width, height, 'live-frame');
      const nativeResult = await detectBarcodeWithNativeFromVariants(variants);
      if (!nativeResult?.code) {
        setScanError('No barcode found in this frame. Move closer, reduce glare, and try again.');
        showScanPopup('error', 'Scan Failed', 'No barcode detected from the live frame.');
        return;
      }
      await handleDetectedCode(nativeResult.code, nativeResult.format);
    } catch {
      setScanError('Frame scan failed. Try again with steadier focus and better lighting.');
      showScanPopup('error', 'Scan Failed', 'Could not scan this camera frame.');
    } finally {
      setIsFrameScanning(false);
    }
  };

  const startScanner = async () => {
    primeNotificationPermission();
    setScanError('');
    setDetectedCode('');
    isHandlingDetectionRef.current = false;
    liveDetectErrorCountRef.current = 0;
    liveDetectStreakRef.current = { code: '', count: 0 };
    lastDetectTsRef.current = 0;

    try {
      if (!canUseBarcodeDetector) {
        try {
          await startQuaggaScanner();
          return;
        } catch {
          // continue to preview-only fallback below
        }
      } else {
        const stream = await requestCameraStream();
        await configureCameraTrack(stream);

        scannerStreamRef.current = stream;
        detectorRef.current = canUseBarcodeDetector
          ? new window.BarcodeDetector({
              formats: SCAN_BARCODE_FORMATS
            })
          : null;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setScannerMode('native');
        isScanningRef.current = true;
        setIsScanning(true);
        scannerFrameRef.current = requestAnimationFrame(detectLoop);
        return;
      }

      // Fallback: show live camera preview even if auto barcode detection is unavailable.
      const stream = await requestCameraStream();
      await configureCameraTrack(stream);
      scannerStreamRef.current = stream;
      detectorRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScannerMode('native');
      isScanningRef.current = true;
      setIsScanning(true);
      setScanError('Camera preview is live. Use Capture Frame Scan for better detection in this browser.');
      showScanPopup('error', 'Auto Scan Unavailable', 'Live preview is on. Use Capture Frame Scan, photo scan, or manual code entry.');
    } catch (error) {
      if (error?.code === 'insecure_context') {
        setScanError('Live camera preview requires HTTPS (or localhost). Use Scan From Photo Library below.');
        showScanPopup('error', 'HTTPS Required', 'Live camera is blocked on non-secure URLs. Use HTTPS or localhost.');
      } else {
        setScanError('Camera access denied or unavailable. Use manual barcode entry below.');
        showScanPopup('error', 'Scan Failed', 'Camera access was denied or unavailable.');
      }
      stopScanner();
    }
  };

  const handleManualScanSubmit = async (e) => {
    e.preventDefault();
    if (!manualScanCode) return;

    primeNotificationPermission();
    const cleanedCode = normalizeBookCode(manualScanCode);
    const scannedBook = await fetchBookByCode(cleanedCode, { showAlert: false });
    if (!scannedBook) {
      showScanPopup('error', 'Lookup Failed', 'No book details were found for that barcode / ISBN.');
      return;
    }

    setManualScanCode('');
    setDetectedCode(cleanedCode);
    setScanError('');
    queueScannedBookForCategory(scannedBook, cleanedCode, 'manual');
    showScanPopup('success', 'Book Found', 'Choose where to categorize this book.');
  };

  return (
    <div className="glass-container mb-4 add-book-shell">
      <div className="add-book-header">
        <h3 className="mb-1">Add a Book</h3>
        <p className="add-book-subtitle mb-0">Search by ISBN, add manually, scan a barcode, or discover manga by title.</p>
      </div>
      <div
        className={`add-book-tabs ${activeTab}-active`}
        style={{ '--tab-index': tabIndex, '--tab-count': tabCount }}
      >
        <span className="tab-slider" />
        <button type="button" className={`add-book-tab-btn ${activeTab === 'isbn' ? 'active' : ''}`} onClick={() => setActiveTab('isbn')}>
          Search by ISBN
        </button>
        <button type="button" className={`add-book-tab-btn ${activeTab === 'manual' ? 'active' : ''}`} onClick={() => setActiveTab('manual')}>
          Manual Entry
        </button>
        <button type="button" className={`add-book-tab-btn ${activeTab === 'scan' ? 'active' : ''}`} onClick={() => setActiveTab('scan')}>
          Scan Barcode
        </button>
        <button type="button" className={`add-book-tab-btn ${activeTab === 'manga' ? 'active' : ''}`} onClick={() => setActiveTab('manga')}>
          Add Manga
        </button>
      </div>

      <div className="add-book-panel-viewport">
        <div
          className={`add-book-panel-track ${activeTab}-active`}
          style={{ '--panel-index': tabIndex, '--panel-count': tabCount }}
        >
          <section className="add-book-panel">
            <form onSubmit={handleIsbnSubmit}>
              <div className="input-group polished-input-group">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Enter ISBN/UPC..."
                  value={isbn}
                  onChange={(e) => setIsbn(e.target.value)}
                />
                <button type="submit" className="btn btn-primary">Add Book</button>
              </div>
            </form>
          </section>

          <section className="add-book-panel">
            <form onSubmit={handleManualSubmit} className="manual-book-form">
              <div className="mb-3">
                <label htmlFor="title" className="form-label">Title</label>
                <input
                  type="text"
                  className="form-control"
                  id="title"
                  value={manualBook.title}
                  onChange={(e) => setManualBook({ ...manualBook, title: e.target.value })}
                  required
                />
              </div>
              <div className="mb-3">
                <label htmlFor="authors" className="form-label">Authors (comma separated)</label>
                <input
                  type="text"
                  className="form-control"
                  id="authors"
                  value={manualBook.authors}
                  onChange={(e) => setManualBook({ ...manualBook, authors: e.target.value })}
                />
              </div>
              <div className="mb-3">
                <label htmlFor="summary" className="form-label">Summary</label>
                <textarea
                  className="form-control"
                  id="summary"
                  rows="3"
                  value={manualBook.summary}
                  onChange={(e) => setManualBook({ ...manualBook, summary: e.target.value })}
                />
              </div>
              <div className="mb-3">
                <label htmlFor="cover" className="form-label">Cover Image URL</label>
                <input
                  type="url"
                  className="form-control"
                  id="cover"
                  value={manualBook.cover}
                  onChange={(e) => setManualBook({ ...manualBook, cover: e.target.value })}
                />
              </div>
              <button type="submit" className="btn btn-primary">Add Book</button>
            </form>
          </section>

          <section className="add-book-panel">
            <div className="text-center scan-panel">
              <p className="scan-panel-copy">Scan a barcode (UPC/EAN/ISBN) to fetch metadata automatically.</p>
              <div className="d-flex justify-content-center flex-wrap gap-2 mb-3 scan-action-row">
                {!isScanning ? (
                  <button
                    className="btn btn-primary"
                    onClick={startScanner}
                    type="button"
                    disabled={isResolvingScan || isPhotoScanning || isFrameScanning}
                  >
                    {isResolvingScan ? 'Fetching book details...' : 'Open Camera Scanner'}
                  </button>
                ) : (
                  <button className="btn btn-outline-secondary" onClick={stopScanner} type="button">
                    Stop Scanner
                  </button>
                )}
                {isScanning && scannerMode === 'native' && (
                  <button
                    className="btn btn-outline-primary"
                    type="button"
                    onClick={scanCurrentFrame}
                    disabled={isResolvingScan || isPhotoScanning || isFrameScanning}
                  >
                    {isFrameScanning ? 'Scanning Frame...' : 'Capture Frame Scan'}
                  </button>
                )}
                <button
                  className="btn btn-outline-secondary"
                  type="button"
                  onClick={handlePhotoScanClick}
                  disabled={isResolvingScan || isPhotoScanning || isFrameScanning}
                >
                  {isPhotoScanning ? 'Scanning Photo...' : 'Scan From Photo Library'}
                </button>
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoScanChange}
                className="d-none"
              />
              <div className="mb-3 scan-preview-shell">
                {scannerMode === 'quagga' ? (
                  <div ref={quaggaContainerRef} className="scan-preview scan-quagga-target" />
                ) : (
                  <video ref={videoRef} className="scan-preview" autoPlay muted playsInline />
                )}
                <div className={`scan-result-popup ${scanPopup.isOpen ? 'show' : ''} ${scanPopup.type}`} aria-live="polite">
                  <div className="scan-result-popup-copy">
                    <strong>{scanPopup.title}</strong>
                    <span>{scanPopup.message}</span>
                  </div>
                  <button type="button" className="scan-result-popup-close" onClick={dismissScanPopup} aria-label="Dismiss scan result">
                    ×
                  </button>
                </div>
                {!isScanning && !isPhotoScanning && (
                  <div className="scan-idle-hint">Camera preview appears here</div>
                )}
              </div>
              {detectedCode && <p className="scan-note">Detected barcode: <strong>{detectedCode}</strong></p>}
              {scanError && <p className="scan-note text-warning">{scanError}</p>}
              {pendingScannedBook && (
                <div className="scan-category-prompt mt-3">
                  <p className="scan-category-title mb-1"><strong>{pendingScannedBook.title}</strong></p>
                  <p className="scan-category-copy mb-2">Where should this book be categorized?</p>
                  <div className="scan-category-actions">
                    {SCAN_CATEGORY_OPTIONS.map((category) => (
                      <button
                        key={category.value}
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={() => handleScannedCategorySelect(category.value)}
                      >
                        {category.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-link btn-sm mt-2 scan-category-cancel"
                    onClick={() => setPendingScannedBook(null)}
                  >
                    Cancel
                  </button>
                </div>
              )}
              <form className="mt-3 scan-manual-form" onSubmit={handleManualScanSubmit}>
                <label className="form-label" htmlFor="manualScanCode">Manual barcode / ISBN</label>
                <div className="input-group polished-input-group">
                  <input
                    id="manualScanCode"
                    type="text"
                    className="form-control"
                    value={manualScanCode}
                    onChange={(e) => setManualScanCode(e.target.value)}
                    placeholder="Enter barcode if camera scan fails"
                  />
                  <button className="btn btn-primary" type="submit">Add by Code</button>
                </div>
              </form>
              {!canUseLiveScanner && (
                <p className="scan-note mt-2">
                  Live video scanning is unavailable in this browser mode. Open Camera Scanner captures a photo and scans it.
                </p>
              )}
            </div>
          </section>

          <section className="add-book-panel">
            <div className="manual-book-form manga-search-form">
              <form onSubmit={handleMangaSearch}>
                <label className="form-label" htmlFor="mangaQuery">Search manga by title</label>
                <div className="input-group polished-input-group">
                  <input
                    id="mangaQuery"
                    type="search"
                    className="form-control"
                    placeholder="One Piece, Naruto, Berserk..."
                    value={mangaQuery}
                    onChange={(event) => {
                      setMangaQuery(event.target.value);
                      if (mangaError) setMangaError('');
                    }}
                  />
                  <button type="submit" className="btn btn-primary" disabled={isMangaSearching}>
                    {isMangaSearching ? 'Searching...' : 'Search'}
                  </button>
                </div>
              </form>

              <div className="manga-search-controls mt-3">
                <label className="form-label mb-1" htmlFor="mangaStatus">Add to category</label>
                <select
                  id="mangaStatus"
                  className="form-select"
                  value={mangaStatus}
                  onChange={(event) => setMangaStatus(event.target.value)}
                >
                  {SCAN_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="manga-meta-grid mt-2">
                  <div>
                    <label className="form-label mb-1" htmlFor="mangaVolume">Volume</label>
                    <input
                      id="mangaVolume"
                      type="number"
                      min="0"
                      step="0.1"
                      className="form-control"
                      placeholder="e.g. 12"
                      value={mangaMeta.volume}
                      onChange={(event) => {
                        setMangaMeta((previous) => ({ ...previous, volume: event.target.value }));
                      }}
                    />
                  </div>
                  <div>
                    <label className="form-label mb-1" htmlFor="mangaChapter">Chapter</label>
                    <input
                      id="mangaChapter"
                      type="number"
                      min="0"
                      step="0.1"
                      className="form-control"
                      placeholder="e.g. 1065"
                      value={mangaMeta.chapter}
                      onChange={(event) => {
                        setMangaMeta((previous) => ({ ...previous, chapter: event.target.value }));
                      }}
                    />
                  </div>
                </div>
                <div className="mt-2">
                  <label className="form-label mb-1" htmlFor="mangaArcTags">Arc tags</label>
                  <input
                    id="mangaArcTags"
                    type="text"
                    className="form-control"
                    placeholder="Wano, Chunin Exams, Shibuya..."
                    value={mangaMeta.arcTags}
                    onChange={(event) => {
                      setMangaMeta((previous) => ({ ...previous, arcTags: event.target.value }));
                    }}
                  />
                </div>
              </div>

              {mangaError && <p className="scan-note text-warning mt-3 mb-0">{mangaError}</p>}
              {mangaNotice && (
                <div className={`friends-notice ${mangaNotice.type === 'error' ? 'error' : 'success'} mt-3`} role="status">
                  {mangaNotice.text}
                </div>
              )}

              {mangaResults.length > 0 && (
                <div className="manga-results-list mt-3">
                  {mangaResults.map((manga, index) => {
                    const mangaKey = `${manga.title}-${manga.authors?.join('|')}-${index}`;
                    return (
                      <article key={mangaKey} className="manga-result-card">
                        <img
                          src={manga.cover || 'https://via.placeholder.com/150x200?text=Manga'}
                          alt={manga.title}
                          className="manga-result-cover"
                        />
                        <div className="manga-result-body">
                          <div className="manga-result-head">
                            <h6 className="mb-1">{manga.title}</h6>
                            <span className="book-media-badge">Manga</span>
                          </div>
                          <p className="manga-result-authors mb-1">
                            {Array.isArray(manga.authors) && manga.authors.length > 0 ? manga.authors.join(', ') : 'Unknown Author'}
                          </p>
                          {manga.seriesType && <p className="manga-result-series mb-1">{manga.seriesType}</p>}
                          <p className="manga-result-summary mb-2">{manga.summary}</p>
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => handleAddMangaResult(manga)}
                          >
                            Add Manga
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default AddBookForm;
