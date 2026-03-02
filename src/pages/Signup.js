import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signUpUser } from '../utils/authStorage';

const Signup = ({ currentUser, onAuthSuccess }) => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState(null);

  useEffect(() => {
    if (currentUser) {
      navigate('/');
    }
  }, [currentUser, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const normalizedUsername = String(username || '').trim().toLowerCase().replace(/^@+/, '');
    if (!/^[a-z0-9]{3,24}$/.test(normalizedUsername)) {
      setFormMessage({ type: 'error', text: 'Username must be 3-24 letters or numbers.' });
      return;
    }

    if (password !== confirmPassword) {
      setFormMessage({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    setIsSubmitting(true);
    setFormMessage(null);

    try {
      const user = await signUpUser({ name, username: normalizedUsername, email, password });
      if (onAuthSuccess) onAuthSuccess(user);
      navigate('/');
    } catch (error) {
      setFormMessage({ type: 'error', text: error?.message || 'Could not create your account.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="glass-container d-flex justify-content-center align-items-center" style={{ minHeight: '80vh' }}>
      <div className="w-100" style={{ maxWidth: '400px' }}>
        <h2 className="text-center mb-4">Sign Up</h2>
        {formMessage && (
          <div className={`friends-notice ${formMessage.type === 'error' ? 'error' : 'success'}`} role="alert">
            {formMessage.text}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label htmlFor="name" className="form-label">Name</label>
            <input
              type="text"
              className="form-control"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="mb-3">
            <label htmlFor="email" className="form-label">Email</label>
            <input
              type="email"
              className="form-control"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="mb-3">
            <label htmlFor="username" className="form-label">Username</label>
            <input
              type="text"
              className="form-control"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              minLength={3}
              maxLength={24}
              autoComplete="username"
              placeholder="chooseusername"
              required
            />
            <small className="settings-file-help">People can add you by this username.</small>
          </div>
          <div className="mb-3">
            <label htmlFor="password" className="form-label">Password</label>
            <input
              type="password"
              className="form-control"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>
          <div className="mb-3">
            <label htmlFor="confirmPassword" className="form-label">Confirm Password</label>
            <input
              type="password"
              className="form-control"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary w-100" disabled={isSubmitting}>
            {isSubmitting ? 'Creating Account...' : 'Sign Up'}
          </button>
        </form>
        <p className="text-center mt-3">
          Already have an account? <Link to="/login">Sign In</Link>
        </p>
      </div>
    </div>
  );
};

export default Signup;
