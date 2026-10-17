import "./globals.css";
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { ThemeProvider } from "@/context/ThemeContext";
import { ViewModeProvider } from "@/context/ViewModeContext";
import { SidebarProvider } from "@/context/SidebarContext";
import AppShell from "@/components/AppShell";
import DevTools from "@/components/DevTools";

export const metadata = {
  title: "TubeLock - Private HLS Streaming",
  description: "Private Client-Side HLS Video Streaming Platform on Next.js",
};

export default async function RootLayout({ children }) {

  const cookieStore = await cookies();
  const token = cookieStore.get("tubelock_session")?.value;

  // Query DB to get session data (token is a hex string, not JSON anymore)
  let session = null;
  if (token) {
    try {
      const sql = getDb();
      const [row] = await sql`
        SELECT u.provider, u.name, u.email, u.picture
        FROM user_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.session_token = ${token}
          AND s.is_active = TRUE
          AND s.expires_at > NOW()
        LIMIT 1
      `;
      session = row || null;
    } catch {
      session = null;
    }
  }

  return (
    <html lang="th" className="h-full antialiased" suppressHydrationWarning>
      <head>
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
        <ThemeProvider>
          <ViewModeProvider>
            <SidebarProvider>
              <AppShell session={session}>{children}</AppShell>
            </SidebarProvider>
          </ViewModeProvider>
        </ThemeProvider>
        {/* <DevTools /> */}
      </body>
    </html>
  );
}

