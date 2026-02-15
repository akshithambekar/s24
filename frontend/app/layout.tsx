import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/query-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistMono = Geist_Mono({
    subsets: ["latin"],
    variable: "--font-geist-mono",
});

export const metadata: Metadata = {
    title: "S24",
    description:
        "Terminal-style ops dashboard for Solana Autopilot trading bot",
};

export const viewport: Viewport = {
    themeColor: "#0f1117",
    width: "device-width",
    initialScale: 1,
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className="dark" suppressHydrationWarning>
            <body
                className={`${geistMono.variable} font-mono antialiased scanline-overlay noise-overlay`}
            >
                <ThemeProvider
                    attribute="class"
                    defaultTheme="dark"
                    enableSystem={false}
                    disableTransitionOnChange
                >
                    <QueryProvider>
                        {children}
                        <Toaster richColors position="bottom-right" />
                    </QueryProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
