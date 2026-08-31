/*
 * Punto de entrada del bundle de Firebase.
 * esbuild lo empaqueta en src/js/vendor/firebase.js (ESM) para que el renderer
 * lo cargue sin bundler en tiempo de ejecucion y sin pedir nada a un CDN
 * (la CSP solo permite scripts propios).
 */

export { initializeApp, getApps, getApp, deleteApp } from 'firebase/app';

export {
  initializeAuth,
  getAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  sendPasswordResetEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
  connectAuthEmulator
} from 'firebase/auth';

export {
  getDatabase,
  ref,
  child,
  get as dbGet,
  set as dbSet,
  update as dbUpdate,
  remove as dbRemove,
  push as dbPush,
  onValue,
  off,
  query,
  orderByChild,
  equalTo,
  limitToLast,
  serverTimestamp,
  goOnline,
  goOffline,
  connectDatabaseEmulator
} from 'firebase/database';
