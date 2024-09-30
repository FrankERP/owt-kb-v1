// app/profile/page.tsx
import React from 'react';
import UserProfile from '@/app/components/UserProfile'; // Ajusta la ruta si es necesario

const ProfilePage: React.FC = () => {
  return (
    <div>
      <h1>User Profile</h1>
      <UserProfile />
    </div>
  );
};

export default ProfilePage;
