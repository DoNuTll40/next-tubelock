import "./globals.css";
import { ViewModeProvider } from "@/context/ViewModeContext";
import { SidebarProvider } from "@/context/SidebarContext";
import AppShell from "@/components/AppShell";
import DevTools from "@/components/DevTools";

export const metadata = {
  title: "TubeLock - Private HLS Streaming",
  description: "Private Client-Side HLS Video Streaming Platform on Next.js",
};

export default function RootLayout({ children }) {
  return (
    <html lang="th" className="h-full antialiased">
      <body className="bg-[#FBF9F5] text-[#212529] min-h-screen selection:bg-orange-100 selection:text-orange-700 antialiased font-sans">
        <ViewModeProvider>
          <SidebarProvider>
            <AppShell>{children}</AppShell>
          </SidebarProvider>
        </ViewModeProvider>
        <DevTools />
      </body>
    </html>
  );
}

