import { useEffect, useState } from "react";
import {
  getWorkspaceGuideOptOutKey,
  shouldAutomaticallyOpenWorkspaceGuide,
} from "../utils/workspaceGuideStorage.js";

export default function useWorkspaceGuide({ role, user, enabled }) {
  const accountIdentity = user?.id ?? user?._id ?? user?.email ?? "";
  const identity = String(accountIdentity).trim().toLowerCase();
  const optOutKey = identity ? getWorkspaceGuideOptOutKey(role, identity) : "";
  const [isOpen, setIsOpen] = useState(false);
  const [doNotShowAutomatically, setDoNotShowAutomatically] = useState(false);

  useEffect(() => {
    setDoNotShowAutomatically(Boolean(
      optOutKey && localStorage.getItem(optOutKey) === "true",
    ));
  }, [optOutKey]);

  useEffect(() => {
    if (!enabled) {
      setIsOpen(false);
      return;
    }
    if (!identity || !optOutKey) return;

    const optedOut = localStorage.getItem(optOutKey) === "true";
    setDoNotShowAutomatically(optedOut);
    if (shouldAutomaticallyOpenWorkspaceGuide(role, identity, optedOut)) setIsOpen(true);
  }, [enabled, identity, optOutKey, role]);

  const updateDoNotShowAutomatically = (checked) => {
    if (!optOutKey) return;
    if (checked) localStorage.setItem(optOutKey, "true");
    else localStorage.removeItem(optOutKey);
    setDoNotShowAutomatically(checked);
  };

  return {
    isOpen,
    setIsOpen,
    doNotShowAutomatically,
    setDoNotShowAutomatically: updateDoNotShowAutomatically,
  };
}
