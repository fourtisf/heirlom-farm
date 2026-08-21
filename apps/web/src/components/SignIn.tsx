'use client';

/**
 * Wallet sign-in.
 *
 * Nonce → sign → session JWT. The wallet only ever signs a login message;
 * nothing here asks for a transaction, and the message says so, because a
 * signature prompt that does not explain itself is how people get drained.
 *
 * Wallets are discovered through EIP-6963 rather than by reading
 * `window.ethereum`. That property holds exactly one provider — whichever
 * extension won the race to claim it, in practice almost always MetaMask — so
 * reading it directly silently locks out every other wallet the player has
 * installed. EIP-6963 asks the page instead, and each wallet announces itself
 * with a name and an icon.
 *
 * No library: this is two browser events. `window.ethereum` stays as the
 * fallback for wallets old enough not to announce.
 */

import { useCallback, useEffect, useState } from 'react';
import { requestNonce, setToken, verifySignature } from '@/game/api';

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface ProviderDetail {
  info: ProviderInfo;
  provider: Eip1193Provider;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export default function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [wallets, setWallets] = useState<ProviderDetail[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Wallets announce on request, and may also announce unprompted as their
     extension finishes loading — so the listener goes up before the ask, and
     stays up. Keyed by rdns because a wallet announcing twice is normal. */
  useEffect(() => {
    const seen = new Map<string, ProviderDetail>();
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<ProviderDetail>).detail;
      if (!detail?.info?.rdns || seen.has(detail.info.rdns)) return;
      seen.set(detail.info.rdns, detail);
      setWallets([...seen.values()]);
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
  }, []);

  const signIn = useCallback(
    async (provider: Eip1193Provider, key: string) => {
      setError(null);
      setBusy(key);
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
        // Wallets report a user-cancelled prompt as an error; it is not one.
        const code = (err as { code?: number })?.code;
        if (code === 4001) setError('Sign-in cancelled.');
        else setError(err instanceof Error ? err.message : 'Sign-in failed.');
      } finally {
        setBusy(null);
      }
    },
    [onSignedIn],
  );

  const legacy = typeof window !== 'undefined' && window.ethereum;
  const hasChoice = wallets.length > 0;

  return (
    <div className="signin">
      <div className="signin__mark">
        <i>A breeding farm</i>
        <h1>HEIRLOM</h1>
        <div className="signin__rule" />
        <p>Anyone can grow a crop. Few can fix a line.</p>
      </div>

      <div className="signin__sheet">
        <p>
          Your vault, your beds and every specimen you press are kept against your wallet. Signing
          in proves the address is yours — it does not authorise any transaction.
        </p>

        {hasChoice ? (
          <div className="wallets">
            {wallets.map((w) => (
              <button
                key={w.info.uuid}
                className="wallet"
                onClick={() => signIn(w.provider, w.info.uuid)}
                disabled={busy !== null}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.info.icon} alt="" width={26} height={26} />
                <span>{w.info.name}</span>
                <em>{busy === w.info.uuid ? 'waiting…' : 'connect'}</em>
              </button>
            ))}
          </div>
        ) : legacy ? (
          <button
            className="btn btn--brass btn--wide"
            onClick={() => signIn(window.ethereum!, 'legacy')}
            disabled={busy !== null}
          >
            {busy ? 'Waiting for your wallet…' : 'Sign in with wallet'}
          </button>
        ) : (
          <div className="signin__none">
            <b>No wallet found in this browser.</b>
            <span>
              Install MetaMask, Rabby, Coinbase Wallet, OKX or any other browser wallet, then
              reload this page.
            </span>
          </div>
        )}

        {error ? <div className="signin__error">{error}</div> : null}
      </div>
    </div>
  );
}
