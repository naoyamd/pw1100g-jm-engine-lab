import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PW1100G-JM | Engineering Lab',
  description:
    '公開資料に基づくPW1100G-JMの3Dカットモデル。減速機、二軸、熱サイクルを検証しながら探索できます。',
  icons: { icon: './favicon.svg' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
