import "../(client)/globals.css";


export const metadata = {
  title: 'OWT - SignUp',
  description: 'Generated by Next.js',
}

export default function RootLayout({
  children,w
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
