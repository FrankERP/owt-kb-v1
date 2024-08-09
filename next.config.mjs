/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.sanity.io",
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)', // Aplica a todas las rutas
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN' // Protege contra clickjacking
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff' // Evita la deducción del tipo de contenido
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block' // Protege contra XSS en navegadores antiguos
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload' // Fuerza el uso de HTTPS
          },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https:; font-src 'self' 'unsafe-inline' data: https:; frame-ancestors 'self'; object-src 'none'; child-src 'self' https: data:;"
          }
          ,
        ]
      }
    ]
  },
};

export default nextConfig;
