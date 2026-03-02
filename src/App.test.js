import { addFriend, getFriends } from './services/backend';
import { getCurrentUser, signInUser, signOutUser, signUpUser, updateCurrentUserName } from './utils/authStorage';

describe('backend service smoke tests', () => {
  test('loads starter friends for current user', async () => {
    const friends = await getFriends(1);
    expect(Array.isArray(friends)).toBe(true);
    expect(friends.length).toBeGreaterThan(0);
    expect(friends.some((friend) => friend?.name === 'Bob')).toBe(true);
  });

  test('adds a friend by username and returns it in the friends list', async () => {
    const result = await addFriend(2, 'diana');
    const friends = await getFriends(2);

    expect(result.friend?.username).toBe('diana');
    expect(friends.some((friend) => friend?.username === 'diana')).toBe(true);
  });
});

describe('auth storage smoke tests', () => {
  beforeEach(() => {
    localStorage.removeItem('bookHubUsers');
    localStorage.removeItem('bookHubCurrentUser');
    localStorage.removeItem('bookHubSessionToken');
    localStorage.removeItem('bookHubBooks');
  });

  test('sign up creates a session user', async () => {
    const user = await signUpUser({
      name: 'Test Reader',
      email: 'reader@example.com',
      password: 'password123'
    });

    expect(user.email).toBe('reader@example.com');
    expect(getCurrentUser()?.email).toBe('reader@example.com');
  });

  test('sign in and sign out update session', async () => {
    await signUpUser({
      name: 'Another Reader',
      email: 'reader2@example.com',
      password: 'password123'
    });
    await signOutUser();

    const signedIn = await signInUser({
      email: 'reader2@example.com',
      password: 'password123'
    });
    expect(signedIn.email).toBe('reader2@example.com');
    expect(getCurrentUser()?.email).toBe('reader2@example.com');

    await signOutUser();
    expect(getCurrentUser()).toBeNull();
  });

  test('display name updates and persists for next sign in', async () => {
    await signUpUser({
      name: 'Name Before',
      email: 'reader3@example.com',
      password: 'password123'
    });

    const updated = await updateCurrentUserName('Name After');
    expect(updated.name).toBe('Name After');
    expect(getCurrentUser()?.name).toBe('Name After');

    await signOutUser();
    const signedIn = await signInUser({
      email: 'reader3@example.com',
      password: 'password123'
    });
    expect(signedIn.name).toBe('Name After');
  });
});
