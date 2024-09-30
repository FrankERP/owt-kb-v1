"use client"
import React, { useEffect, useState } from "react";
import { auth } from "@/firebaseConfig";
import { onAuthStateChanged, signOut } from "firebase/auth";

const UserProfile: React.FC = () => {
  const [user, setUser] = useState<firebase.User | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = () => {
    signOut(auth);
  };

  return (
    <div>
      {user ? (
        <>
          <h2>Welcome, {user.email}</h2>
          <button onClick={handleLogout}>Logout</button>
        </>
      ) : (
        <p>No user is logged in</p>
      )}
    </div>
  );
};

export default UserProfile;
