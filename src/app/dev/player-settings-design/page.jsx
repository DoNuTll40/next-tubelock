import PlayerSettingsDesign from './PlayerSettingsDesign';

export const metadata = {
  title: 'การเล่นและตัวเล่น · TubeLock Dev',
  robots: { index: false, follow: false },
};

export default async function Page({ searchParams }) {
  const { sample } = await searchParams;
  const legacyFit = sample === 'contain' || sample === 'cover' ? sample : null;

  return <PlayerSettingsDesign key={legacyFit ?? 'default'} legacyFit={legacyFit} />;
}
