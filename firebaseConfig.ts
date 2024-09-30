import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, isSupported} from "firebase/analytics";


const firebaseConfig = {
  apiKey: "AIzaSyAXzQYmLo98eZ8d-U4UCQ8bBED-qn-668k",
  authDomain: "owt-knowledge-base.firebaseapp.com",
  projectId: "owt-knowledge-base",
  storageBucket: "owt-knowledge-base.appspot.com",
  messagingSenderId: "576145690934",
  appId: "1:576145690934:web:0650e4b648edc7332be397",
  measurementId: "G-KQ5754M9ML"
};

const app = initializeApp(firebaseConfig);

// Exporta los servicios que necesitas
export const auth = getAuth(app);
export const db = getFirestore(app);
let analytics;
if (typeof window !== "undefined") {
  isSupported().then((yes) => {
    if (yes) {
      analytics = getAnalytics(app);
    }
  });
}
