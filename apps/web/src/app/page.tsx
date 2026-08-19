'use client';

import { useEffect, useState } from 'react';
import GameSurface from '@/components/GameSurface';
import SignIn from '@/components/SignIn';
import { getToken } from '@/game/api';

export default function Page() {
  /* `null` while we have not looked yet, so the sign-in sheet does not flash
     in front of a player who is already signed in. */
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    setSignedIn(Boolean(getToken()));
  }, []);

  if (signedIn === null) return null;
  if (!signedIn) return <SignIn onSignedIn={() => setSignedIn(true)} />;
  return <GameSurface />;
}
