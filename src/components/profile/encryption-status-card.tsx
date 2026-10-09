"use client";

import * as React from "react";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getLocalIdentity, saveLocalIdentity } from "@/lib/crypto/keystore";
import { restoreKeypairFromRecoveryCode } from "@/lib/crypto/recovery";
import { toBase64 } from "@/lib/crypto/sodium";
import type { UserKeyStatus } from "@/lib/crypto/types";
import { Lock, ShieldCheck, AlertTriangle, KeyRound, CheckCircle2 } from "lucide-react";

export interface EncryptionStatusCardProps {
  serverKeyStatus?: UserKeyStatus;
}

export function EncryptionStatusCard({ serverKeyStatus }: EncryptionStatusCardProps) {
  const [localKeyStatus, setLocalKeyStatus] = React.useState<
    "checking" | "active" | "missing"
  >("checking");
  const [recoveryPhrase, setRecoveryPhrase] = React.useState("");
  const [isRestoring, setIsRestoring] = React.useState(false);
  const [restoreError, setRestoreError] = React.useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = React.useState(false);

  // Check local IndexedDB key integrity against active server public key
  React.useEffect(() => {
    let isCancelled = false;

    async function checkLocalKey() {
      try {
        const local = await getLocalIdentity();
        if (!local) {
          if (!isCancelled) setLocalKeyStatus("missing");
          return;
        }

        if (serverKeyStatus?.hasActiveKey && serverKeyStatus.activePublicKey) {
          const localPkBase64 = await toBase64(local.publicKey);
          if (localPkBase64 === serverKeyStatus.activePublicKey) {
            if (!isCancelled) setLocalKeyStatus("active");
            return;
          }
        }

        // Key exists locally and server has no conflicting key, or matched
        if (!isCancelled) {
          setLocalKeyStatus(
            serverKeyStatus?.hasActiveKey ? "missing" : "active"
          );
        }
      } catch {
        if (!isCancelled) setLocalKeyStatus("missing");
      }
    }

    checkLocalKey();

    return () => {
      isCancelled = true;
    };
  }, [serverKeyStatus]);

  // Handle recovery phrase restoration
  const handleRestoreKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRestoring || !recoveryPhrase.trim()) return;

    setIsRestoring(true);
    setRestoreError(null);
    setRestoreSuccess(false);

    try {
      const restored = await restoreKeypairFromRecoveryCode(recoveryPhrase.trim());
      const restoredPkBase64 = await toBase64(restored.publicKey);

      // Verify that the restored key matches the server's registered key
      if (
        serverKeyStatus?.hasActiveKey &&
        serverKeyStatus.activePublicKey &&
        restoredPkBase64 !== serverKeyStatus.activePublicKey
      ) {
        setRestoreError(
          "The provided recovery phrase derives a key that does not match this account's registered public key."
        );
        return;
      }

      // Save valid identity to local IndexedDB
      await saveLocalIdentity(
        {
          publicKey: restored.publicKey,
          privateKey: restored.privateKey,
        },
        serverKeyStatus?.activeKeyId || undefined
      );

      setLocalKeyStatus("active");
      setRestoreSuccess(true);
      setRecoveryPhrase("");
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Invalid recovery phrase. Please check formatting.";
      setRestoreError(message);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <Surface className="p-6 sm:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight text-[#111111] dark:text-[#f4f4f2]">
            End-to-End Encryption & Key Security
          </h2>
          <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a] mt-1 leading-relaxed">
            Messages are sealed in the sender&apos;s browser using Libsodium Sealed Box.
            Your private decryption key is never transmitted or stored on any server.
          </p>
        </div>
        <div className="p-2 rounded-[8px] bg-[#f4f4f5] dark:bg-[#1a1a1d] text-[#0070e0] shrink-0">
          <Lock className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Cryptographic Protocol */}
        <div className="p-4 rounded-[10px] border border-[#ebebeb] dark:border-white/[0.08] bg-[#fafafa] dark:bg-[#111113] space-y-1">
          <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">Encryption Protocol</p>
          <p className="text-sm font-medium text-[#111111] dark:text-[#f4f4f2]">
            Libsodium Sealed Box
          </p>
          <p className="text-[11px] font-mono text-[#6b6b6b] dark:text-[#8f8f8a]">
            Curve25519 (X25519) + XSalsa20-Poly1305
          </p>
        </div>

        {/* Public Key Registration Status */}
        <div className="p-4 rounded-[10px] border border-[#ebebeb] dark:border-white/[0.08] bg-[#fafafa] dark:bg-[#111113] space-y-1">
          <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">Server Public Key</p>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[#111111] dark:text-[#f4f4f2]">
              {serverKeyStatus?.hasActiveKey ? "Registered & Active" : "Unregistered"}
            </span>
            {serverKeyStatus?.hasActiveKey && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#caface]/50 text-[#0e7a2f] dark:bg-[#0e7a2f]/30 dark:text-[#caface]">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                Active
              </span>
            )}
          </div>
          {serverKeyStatus?.activePublicKey ? (
            <p className="text-[11px] font-mono text-[#6b6b6b] dark:text-[#8f8f8a] truncate">
              {serverKeyStatus.activePublicKey.slice(0, 12)}...
              {serverKeyStatus.activePublicKey.slice(-8)}
            </p>
          ) : (
            <p className="text-[11px] text-[#6b6b6b] dark:text-[#8f8f8a]">
              No active public key registered
            </p>
          )}
        </div>
      </div>

      {/* Local Storage Device State */}
      <div className="p-4 rounded-[10px] border border-[#ebebeb] dark:border-white/[0.08] bg-[#fafafa] dark:bg-[#111113] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-[#333333] dark:text-[#d6d6d3]">
            Device Key Storage (This Browser)
          </span>
          {localKeyStatus === "active" ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-[#0e7a2f] dark:text-[#caface] font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-[#15b042]" aria-hidden="true" />
              Key Active & Stored in IndexedDB
            </span>
          ) : localKeyStatus === "missing" ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-[#b42318] dark:text-[#f97066] font-medium">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              Key Missing from this Device
            </span>
          ) : (
            <span className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a]">Checking...</span>
          )}
        </div>

        {localKeyStatus === "active" ? (
          <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a] leading-relaxed">
            Your private decryption key is securely stored in this browser&apos;s local
            IndexedDB storage. Profile and account changes never modify or regenerate
            your encryption keys.
          </p>
        ) : localKeyStatus === "missing" ? (
          <div className="space-y-4 pt-1">
            <p className="text-xs text-[#6b6b6b] dark:text-[#8f8f8a] leading-relaxed">
              Your device does not have your private decryption key stored locally.
              Enter your 256-bit recovery phrase to restore your key and decrypt messages
              on this device.
            </p>

            {restoreSuccess && (
              <div
                className="rounded-[8px] border border-[#15b042]/20 bg-[#caface]/30 dark:bg-[#0e7a2f]/20 p-3 flex items-center gap-2 text-xs text-[#0e7a2f] dark:text-[#caface]"
                role="status"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Encryption key successfully restored to this device.</span>
              </div>
            )}

            {restoreError && (
              <div
                className="rounded-[8px] border border-[#d92d20]/20 bg-[#ffe8e6] dark:bg-[#3a1512] p-3 text-xs text-[#b42318] dark:text-[#f97066]"
                role="alert"
              >
                {restoreError}
              </div>
            )}

            <form onSubmit={handleRestoreKey} className="space-y-3 max-w-md">
              <Input
                id="settings-recovery-phrase"
                name="recoveryPhrase"
                label="Recovery Phrase (Hex or Base64)"
                value={recoveryPhrase}
                onChange={(e) => setRecoveryPhrase(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                className="font-mono text-xs"
                disabled={isRestoring}
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={isRestoring}
                disabled={isRestoring || !recoveryPhrase.trim()}
              >
                {isRestoring ? "Verifying phrase..." : "Restore Key to Device"}
              </Button>
            </form>
          </div>
        ) : null}
      </div>

      {/* Cryptographic limitation notice */}
      <div className="rounded-[8px] bg-[#f4f4f5]/60 dark:bg-[#1a1a1d]/60 border border-[#ebebeb] dark:border-white/[0.06] p-4 text-xs text-[#6b6b6b] dark:text-[#8f8f8a] leading-relaxed flex items-start gap-3">
        <KeyRound className="h-4 w-4 shrink-0 mt-0.5 text-[#6b6b6b] dark:text-[#8f8f8a]" aria-hidden="true" />
        <p>
          <strong className="font-medium text-[#111111] dark:text-[#f4f4f2]">
            Key Recovery Policy:
          </strong>{" "}
          Because the server never holds private keys, lost keys cannot be recovered
          by platform administrators. Keep your 256-bit recovery phrase stored in a
          secure offline location.
        </p>
      </div>
    </Surface>
  );
}
