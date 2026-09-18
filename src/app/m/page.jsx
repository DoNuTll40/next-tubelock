import FeedPage from '@/app/page';

export const metadata = {
  title: "TubeLock Mobile - Private HLS Streaming",
  description: "Mobile Web Version of TubeLock",
};

export default function MobilePage() {
  return <FeedPage isMobileView={true} />;
}
