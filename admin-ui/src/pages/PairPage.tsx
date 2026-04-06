import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { OtpInput } from "../components/OtpInput";

export function PairPage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{
    text: string;
    type: "info" | "success" | "error";
  } | null>(null);

  const handleOtpComplete = (code: string) => {
    setSubmitting(true);
    setStatus({ text: "Verifying code...", type: "info" });

    apiFetch("/api/v1/auth/pair/claim", {
      method: "POST",
      body: JSON.stringify({ code }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Invalid pairing code");
        setStatus({
          text: "Device linked successfully. Redirecting...",
          type: "success",
        });
        setTimeout(() => navigate("/admin/devices"), 2000);
      })
      .catch((e: Error) => {
        setStatus({ text: e.message, type: "error" });
        setSubmitting(false);
      });
  };

  const statusColor =
    status?.type === "success"
      ? "text-emerald-400"
      : status?.type === "error"
        ? "text-red-400"
        : "text-slate-400";

  return (
    <div id="page-pair" className="space-y-6 max-w-xl">
      {/* Back */}
      <Link
        to="/admin/devices"
        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
        Back to Devices
      </Link>

      <div>
        <h2 className="text-base font-semibold text-slate-100">
          Enrol a Device
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Choose how to link the new device to your account.
        </p>
      </div>

      {/* Method 1: Pairing code */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 space-y-5">
        <div>
          <p className="text-sm font-semibold text-slate-100">
            Enter pairing code
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Run{" "}
            <code className="font-mono bg-slate-700 px-1 py-0.5 rounded">
              selkie enroll
            </code>{" "}
            on the device. It will display a 6-character code &mdash; enter it
            below.
          </p>
        </div>

        <OtpInput onComplete={handleOtpComplete} disabled={submitting} />

        {status && (
          <div id="pair-status" className={`text-sm ${statusColor}`}>
            {status.text}
          </div>
        )}

        <button
          id="pair-submit"
          disabled={submitting}
          onClick={() => {}}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded transition-colors"
        >
          {submitting ? "Linking..." : "Link device"}
        </button>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 border-t border-slate-800"></div>
        <span className="text-xs text-slate-600">or</span>
        <div className="flex-1 border-t border-slate-800"></div>
      </div>

      {/* Method 2: CLI SSO */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 space-y-3">
        <div>
          <p className="text-sm font-semibold text-slate-100">
            SSO from the device
          </p>
          <p className="text-xs text-slate-500 mt-1">
            If you&apos;re sitting at the machine, run the command below. A
            browser will open and the device will enrol automatically once you
            sign in.
          </p>
        </div>
        <div className="bg-slate-900 rounded-lg px-4 py-3 font-mono text-sm text-indigo-300 flex items-center justify-between">
          <span>selkie enroll --sso</span>
          <button
            onClick={() =>
              navigator.clipboard.writeText("selkie enroll --sso")
            }
            className="text-slate-500 hover:text-slate-300 transition-colors ml-4 shrink-0"
            title="Copy"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-slate-600">
          The CLI polls with exponential backoff and completes enrollment
          automatically after login.
        </p>
      </div>
    </div>
  );
}
