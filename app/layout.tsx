export const metadata = {
  title: "Analog Horror - 60s Short",
  description: "A 60-second cinematic horror sequence with Hindi voiceover and English subtitles"
};

import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
