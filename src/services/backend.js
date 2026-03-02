import { apiRequest, canUseBackend } from './apiClient';
import { getCurrentUser } from '../utils/authStorage';

let users = [
    { id: 1, name: 'Alice', username: 'alice' },
    { id: 2, name: 'Bob', username: 'bob' },
    { id: 3, name: 'Charlie', username: 'charlie' },
    { id: 4, name: 'Diana', username: 'diana' },
];

let friends = {
    1: [2, 3, 4],
    2: [1, 3],
    3: [1, 2],
    4: [1],
};

let books = {
    1: [
        { id: 'a1', title: "The Hitchhiker's Guide to the Galaxy", authors: ['Douglas Adams'], status: 'read', thoughts: 'A hilarious sci-fi classic!', description: 'A comedy science fiction franchise that follows the misadventures of Arthur Dent, a hapless Englishman who escapes the destruction of Earth.', cover: 'https://covers.openlibrary.org/b/id/8225261-M.jpg', addedAt: '2026-02-20T20:30:00Z' },
        { id: 'a2', title: 'The Great Gatsby', authors: ['F. Scott Fitzgerald'], status: 'read', thoughts: 'Beautiful prose about the American Dream.', description: 'A classic American novel set in the Jazz Age, following the mysterious millionaire Jay Gatsby and his obsession with Daisy Buchanan.', cover: 'https://covers.openlibrary.org/b/id/7358216-M.jpg', addedAt: '2026-02-18T15:10:00Z' },
    ],
    2: [
        { id: 'b1', title: 'Dune', authors: ['Frank Herbert'], status: 'currently reading', thoughts: 'The world-building is incredible.', description: 'A science fiction epic set on the desert planet Arrakis, following Paul Atreides as he navigates political intrigue and prophecy.', cover: 'https://covers.openlibrary.org/b/id/7222246-M.jpg', addedAt: '2026-02-22T11:45:00Z' },
        { id: 'b2', title: 'The Lord of the Rings', authors: ['J.R.R. Tolkien'], status: 'read', thoughts: 'An epic journey that never gets old.', description: 'An epic fantasy trilogy following the quest to destroy a powerful ring and defeat the dark lord Sauron.', cover: 'https://covers.openlibrary.org/b/id/8302842-M.jpg', addedAt: '2026-02-17T08:12:00Z' },
        { id: 'b3', title: 'Neuromancer', authors: ['William Gibson'], status: 'unread', thoughts: '', description: 'A groundbreaking cyberpunk novel about hackers, artificial intelligence, and virtual reality in a dystopian future.', cover: 'https://covers.openlibrary.org/b/id/8231991-M.jpg', addedAt: '2026-02-16T18:25:00Z' },
    ],
    3: [
        { id: 'c1', title: 'Pride and Prejudice', authors: ['Jane Austen'], status: 'read', thoughts: 'Elizabeth Bennet is my spirit animal.', description: 'A romantic novel about manners, upbringing, morality, and marriage in early 19th-century England.', cover: 'https://covers.openlibrary.org/b/id/8231859-M.jpg', addedAt: '2026-02-19T13:05:00Z' },
        { id: 'c2', title: 'The Name of the Wind', authors: ['Patrick Rothfuss'], status: 'currently reading', thoughts: 'Kvothe is such a compelling character.', description: 'The first book in The Kingkiller Chronicle, following the life story of the legendary figure Kvothe.', cover: 'https://covers.openlibrary.org/b/id/8259457-M.jpg', addedAt: '2026-02-21T09:40:00Z' },
    ],
    4: [
        { id: 'd1', title: 'The Martian', authors: ['Andy Weir'], status: 'read', thoughts: 'Science and survival - what a combo!', description: 'A survival story following astronaut Mark Watney who is stranded on Mars and must use his ingenuity to survive.', cover: 'https://covers.openlibrary.org/b/id/8316736-M.jpg', addedAt: '2026-02-14T14:00:00Z' },
        { id: 'd2', title: 'Project Hail Mary', authors: ['Andy Weir'], status: 'unread', thoughts: '', description: 'A science fiction novel about a lone astronaut on a mission to save humanity from an extinction-level threat.', cover: 'https://covers.openlibrary.org/b/id/12682191-M.jpg', addedAt: '2026-02-13T10:22:00Z' },
        { id: 'd3', title: 'The Three-Body Problem', authors: ['Cixin Liu'], status: 'currently reading', thoughts: 'Mind-bending hard sci-fi.', description: 'A hard science fiction novel involving first contact with an alien civilization and complex physics concepts.', cover: 'https://covers.openlibrary.org/b/id/8274944-M.jpg', addedAt: '2026-02-23T06:45:00Z' },
    ]
};

let friendRequests = [];

const getPreferredUserId = (providedUserId) => {
    const currentUser = getCurrentUser();
    if (currentUser?.id) return currentUser.id;
    return providedUserId || 1;
};

const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
const normalizeUsername = (value) => String(value || '').trim().toLowerCase();
const normalizeUsernameInput = (value) => normalizeUsername(String(value || '').replace(/^@+/, ''));
const isValidUsername = (value) => /^[a-z0-9]{3,24}$/.test(normalizeUsernameInput(value));

const toPublicUser = (user) => (user ? {
    id: user.id,
    name: user.name,
    username: user.username || '',
    email: user.email || ''
} : null);

const buildLocalRequestView = (request) => ({
    id: request.id,
    status: request.status,
    createdAt: request.createdAt,
    respondedAt: request.respondedAt || null,
    fromUser: toPublicUser(users.find((entry) => String(entry.id) === String(request.fromUserId))),
    toUser: toPublicUser(users.find((entry) => String(entry.id) === String(request.toUserId)))
});

export const getFriends = async (userId) => {
    if (canUseBackend()) {
        try {
            const response = await apiRequest({
                method: 'GET',
                path: '/api/friends'
            });
            return Array.isArray(response.data?.friends) ? response.data.friends : [];
        } catch {
            // Fallback to local in-memory data if backend call fails.
        }
    }

    await sleep(250);
    const resolvedUserId = getPreferredUserId(userId);
    const friendIds = friends[resolvedUserId] || [];
    const friendDetails = friendIds.map(id => users.find(u => String(u.id) === String(id))).filter(Boolean);
    return friendDetails;
};

export const getFriendBooks = async (friendId) => {
    if (canUseBackend()) {
        try {
            const response = await apiRequest({
                method: 'GET',
                path: `/api/friends/${encodeURIComponent(friendId)}/books`
            });
            return Array.isArray(response.data?.books) ? response.data.books : [];
        } catch {
            // Fallback to local in-memory data if backend call fails.
        }
    }

    await sleep(250);
    return books[friendId] || [];
};

export const addFriend = async (userId, rawFriendUsername) => {
    const normalizedUsername = normalizeUsernameInput(rawFriendUsername);
    if (!isValidUsername(normalizedUsername)) {
        throw new Error('Enter a valid username (3-24 letters or numbers).');
    }

    if (canUseBackend()) {
        try {
            const response = await apiRequest({
                method: 'POST',
                path: '/api/friends',
                data: { username: normalizedUsername }
            });

            return {
                friend: response.data?.friend,
                created: false,
                alreadyFriend: Boolean(response.data?.alreadyFriend),
                requestPending: Boolean(response.data?.requestPending),
                accepted: Boolean(response.data?.accepted),
                direction: response.data?.direction || '',
                requestId: response.data?.requestId || ''
            };
        } catch (error) {
            const backendMessage = error?.response?.data?.error;
            throw new Error(backendMessage || 'Could not add this friend right now.');
        }
    }

    await sleep(240);

    const friend = users.find((entry) => normalizeUsername(entry.username) === normalizedUsername);
    if (!friend) {
        throw new Error('No account found with that username.');
    }

    const resolvedUserId = getPreferredUserId(userId);
    const currentFriendIds = Array.isArray(friends[resolvedUserId]) ? [...friends[resolvedUserId]] : [];
    const alreadyFriend = currentFriendIds.includes(friend.id);

    if (!alreadyFriend) {
        currentFriendIds.push(friend.id);
    }
    friends = {
        ...friends,
        [resolvedUserId]: currentFriendIds
    };

    const reciprocalFriendIds = Array.isArray(friends[friend.id]) ? [...friends[friend.id]] : [];
    if (!reciprocalFriendIds.includes(resolvedUserId)) {
        reciprocalFriendIds.push(resolvedUserId);
    }
    friends = {
        ...friends,
        [friend.id]: reciprocalFriendIds
    };

    if (!books[friend.id]) {
        books = { ...books, [friend.id]: [] };
    }

    return {
        friend,
        created: false,
        alreadyFriend,
        requestPending: false,
        accepted: !alreadyFriend,
        direction: '',
        requestId: ''
    };
};

export const getFriendRequests = async (userId) => {
    if (canUseBackend()) {
        try {
            const response = await apiRequest({
                method: 'GET',
                path: '/api/friends/requests'
            });

            return {
                incoming: Array.isArray(response.data?.incoming) ? response.data.incoming : [],
                outgoing: Array.isArray(response.data?.outgoing) ? response.data.outgoing : []
            };
        } catch {
            // Fallback to local in-memory data if backend call fails.
        }
    }

    await sleep(180);
    const resolvedUserId = getPreferredUserId(userId);
    const incoming = friendRequests
        .filter((request) => String(request.toUserId) === String(resolvedUserId) && request.status === 'pending')
        .map((request) => buildLocalRequestView(request));

    const outgoing = friendRequests
        .filter((request) => String(request.fromUserId) === String(resolvedUserId) && request.status === 'pending')
        .map((request) => buildLocalRequestView(request));

    return { incoming, outgoing };
};

export const respondToFriendRequest = async (requestId, action) => {
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (normalizedAction !== 'accept' && normalizedAction !== 'decline') {
        throw new Error('Invalid friend request action.');
    }

    if (canUseBackend()) {
        try {
            const response = await apiRequest({
                method: 'POST',
                path: `/api/friends/requests/${encodeURIComponent(requestId)}/${normalizedAction}`
            });
            return {
                request: response.data?.request || null,
                friend: response.data?.friend || null
            };
        } catch (error) {
            const backendMessage = error?.response?.data?.error;
            throw new Error(backendMessage || 'Could not update this friend request right now.');
        }
    }

    await sleep(180);
    const resolvedUserId = getPreferredUserId();
    const requestIndex = friendRequests.findIndex(
        (request) =>
            String(request.id) === String(requestId) &&
            String(request.toUserId) === String(resolvedUserId) &&
            request.status === 'pending'
    );

    if (requestIndex < 0) {
        throw new Error('Friend request not found.');
    }

    const target = { ...friendRequests[requestIndex] };
    target.status = normalizedAction === 'accept' ? 'accepted' : 'declined';
    target.respondedAt = new Date().toISOString();
    friendRequests = friendRequests.map((request, index) => (index === requestIndex ? target : request));

    if (normalizedAction === 'accept') {
        const myFriendIds = Array.isArray(friends[resolvedUserId]) ? [...friends[resolvedUserId]] : [];
        if (!myFriendIds.includes(target.fromUserId)) myFriendIds.push(target.fromUserId);
        friends = { ...friends, [resolvedUserId]: myFriendIds };

        const reciprocal = Array.isArray(friends[target.fromUserId]) ? [...friends[target.fromUserId]] : [];
        if (!reciprocal.includes(resolvedUserId)) reciprocal.push(resolvedUserId);
        friends = { ...friends, [target.fromUserId]: reciprocal };
    }

    const friend = users.find((entry) => String(entry.id) === String(target.fromUserId));
    return {
        request: buildLocalRequestView(target),
        friend: toPublicUser(friend)
    };
};

export const removeFriend = async (friendId, userId) => {
    if (canUseBackend()) {
        try {
            const response = await apiRequest({
                method: 'DELETE',
                path: `/api/friends/${encodeURIComponent(friendId)}`
            });
            return {
                success: Boolean(response.data?.success),
                removedFriendId: response.data?.removedFriendId || friendId
            };
        } catch (error) {
            const backendMessage = error?.response?.data?.error;
            throw new Error(backendMessage || 'Could not remove this friend right now.');
        }
    }

    await sleep(180);
    const resolvedUserId = getPreferredUserId(userId);
    const hasFriend = Array.isArray(friends[resolvedUserId]) &&
        friends[resolvedUserId].some((id) => String(id) === String(friendId));
    if (!hasFriend) {
        throw new Error('Friend not found in your list.');
    }

    const mine = Array.isArray(friends[resolvedUserId]) ? friends[resolvedUserId].filter((id) => String(id) !== String(friendId)) : [];
    const theirs = Array.isArray(friends[friendId]) ? friends[friendId].filter((id) => String(id) !== String(resolvedUserId)) : [];
    friends = { ...friends, [resolvedUserId]: mine, [friendId]: theirs };

    friendRequests = friendRequests.map((request) => {
        const betweenUsers =
            (String(request.fromUserId) === String(resolvedUserId) && String(request.toUserId) === String(friendId)) ||
            (String(request.fromUserId) === String(friendId) && String(request.toUserId) === String(resolvedUserId));
        if (!betweenUsers || request.status !== 'pending') return request;
        return {
            ...request,
            status: 'declined',
            respondedAt: new Date().toISOString()
        };
    });

    return { success: true };
};
