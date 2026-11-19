import "./globals.css";
import { getCachedServerSession } from '@/lib/access';
import NextTopLoader from 'nextjs-toploader';
import { ThemeProvider } from "@/context/ThemeContext";
import { ViewModeProvider } from "@/context/ViewModeContext";
import { SidebarProvider } from "@/context/SidebarContext";
import AppShell from "@/components/AppShell";
import PwaRegistration from "@/components/PwaRegistration";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://tubelock.vercel.app';

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0F0F0F",
};

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "TubeLock - Private HLS Streaming",
    template: "%s - TubeLock",
  },
  description: "Private Client-Side HLS Video Streaming Platform on Next.js - แพลตฟอร์มสตรีมมิ่งวิดีโอส่วนตัว ไร้โฆษณา ความคมชัดสูง",
  applicationName: "TubeLock",
  authors: [{ name: "TubeLock" }],
  creator: "TubeLock",
  publisher: "TubeLock",
  alternates: {
    canonical: '/',
  },
  appleWebApp: { capable: true, title: "TubeLock", statusBarStyle: "default" },
  icons: {
    icon: "/images/TubeLock.png",
    shortcut: "/images/TubeLock.png",
    apple: { url: "/images/pwa-180.png", sizes: "180x180", type: "image/png" },
  },
  openGraph: {
    type: "website",
    locale: "th_TH",
    url: SITE_URL,
    siteName: "TubeLock",
    title: "TubeLock - Private HLS Streaming",
    description: "Private Client-Side HLS Video Streaming Platform on Next.js - แพลตฟอร์มสตรีมมิ่งวิดีโอส่วนตัว ไร้โฆษณา ความคมชัดสูง",
    images: [
      {
        url: "/images/TubeLock.png",
        width: 1000,
        height: 1000,
        type: "image/png",
        alt: "TubeLock - Private HLS Streaming",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@tubelock",
    creator: "@tubelock",
    title: "TubeLock - Private HLS Streaming",
    description: "Private Client-Side HLS Video Streaming Platform on Next.js - แพลตฟอร์มสตรีมมิ่งวิดีโอส่วนตัว ไร้โฆษณา ความคมชัดสูง",
    images: ["/images/TubeLock.png"],
  },
};

export default async function RootLayout({ children }) {
  const session = await getCachedServerSession();

  return (
    <html lang="th" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/images/TubeLock.png" type="image/png" />
        <link rel="preconnect" href="https://donut-font.vercel.app" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://donut-font.vercel.app" />
        <link
          rel="stylesheet"
          href="https://donut-font.vercel.app/api/css2?family=Graphik+Thai+Loop:wght@400;500;600;700&display=swap"
        />
        <link rel="preconnect" href={process.env.CF_WORKER_URL || 'https://tubelock-cache.iinter731.workers.dev'} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={process.env.CF_WORKER_URL || 'https://tubelock-cache.iinter731.workers.dev'} />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = localStorage.getItem('tubelock_theme') || 'auto';
                  var isDark = false;
                  if (stored === 'dark') {
                    isDark = true;
                  } else if (stored === 'light') {
                    isDark = false;
                  } else {
                    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  }
                  if (isDark) {
                    document.documentElement.classList.add('dark');
                    document.documentElement.style.colorScheme = 'dark';
                  } else {
                    document.documentElement.classList.remove('dark');
                    document.documentElement.style.colorScheme = 'light';
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="bg-[#FBF9F5] text-[#212529] dark:bg-[#0F0F0F] dark:text-[#F1F1F1] min-h-screen selection:bg-[#FF7A00]/25 selection:text-[#0F0F0F] dark:selection:text-[#FFFFFF] antialiased font-sans transition-colors duration-200">
        <NextTopLoader
          color="#FF7A00"
          initialPosition={0.08}
          crawlSpeed={200}
          height={2.5}
          crawl={true}
          showSpinner={false}
          easing="ease"
          speed={200}
          shadow="0 0 12px #FF7A00, 0 0 4px #FF7A00"
          zIndex={999999}
          showAtBottom={false}
        />
        <ThemeProvider>
          <ViewModeProvider>
            <SidebarProvider>
              <AppShell session={session}>{children}</AppShell>
            </SidebarProvider>
          </ViewModeProvider>
        </ThemeProvider>
        <PwaRegistration />
      </body>
    </html>
  );
}

