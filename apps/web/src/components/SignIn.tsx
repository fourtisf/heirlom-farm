'use client';

/**
 * Wallet sign-in.
 *
 * Nonce → sign → session JWT, the same handshake as Robinfun. The wallet only
 * ever signs a login message; nothing here asks for a transaction, and the
 * message says so, because a signature prompt that does not explain itself is
 * how people get drained.
 */

import { useState } from 'react';
import { requestNonce, setToken, verifySignature } from '@/game/api';

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export default function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setError(null);
    const provider = window.ethereum;
    if (!provider) {
      setError('No wallet found in this browser.');
      return;
    }

    setBusy(true);
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      const wallet = accounts[0];
      if (!wallet) throw new Error('No account selected.');

      const { nonce, message } = await requestNonce(wallet);
      const signature = (await provider.request({
        method: 'personal_sign',
        params: [message, wallet],
      })) as string;

      const { token } = await verifySignature(wallet, nonce, signature);
      setToken(token);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <div className="signin__mark">
        <i>A breeding farm</i>
        <h1>HEIRLOOM</h1>
        <div className="signin__rule" />
        <p>Anyone can grow a crop. Few can fix a line.</p>
      </div>

      <div className="signin__sheet">
        <p>
          Your vault, your beds and every specimen you press are kept against your wallet. Signing
          in proves the address is yours — it does not authorise any transaction.
        </p>
        <button className="btn btn--brass btn--wide" onClick={connect} disabled={busy}>
          {busy ? 'Waiting for your wallet…' : 'Sign in with wallet'}
        </button>
        {error ? <div className="signin__error">{error}</div> : null}
      </div>
    </div>
  );
}
