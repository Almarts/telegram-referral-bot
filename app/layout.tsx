import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Telegram Bot",
  description: "Telegram subscription bot",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
