import React from 'react';
import Login from '@/app/components/Login'; // Asegúrate de que la ruta sea correcta

const LoginPage: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="bg-gray-800 p-8 rounded-lg shadow-lg max-w-md w-full">
        <h1 className="text-3xl font-bold text-center text-white mb-6">Login</h1>
        <Login />
      </div>
    </div>
  );
};

export default LoginPage;
