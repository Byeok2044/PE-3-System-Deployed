const SESSION_KEY_PREFIX = "retainify_workspace_guide_seen:";
const OPT_OUT_KEY_PREFIX = "retainify_workspace_guide_opt_out:";

export const getWorkspaceGuideSessionKey = (role) => `${SESSION_KEY_PREFIX}${role}`;

export const getWorkspaceGuideOptOutKey = (role, identity) =>
  `${OPT_OUT_KEY_PREFIX}${role}:${encodeURIComponent(identity)}`;

export const shouldAutomaticallyOpenWorkspaceGuide = (role, identity, optedOut) => {
  const sessionKey = getWorkspaceGuideSessionKey(role);
  const alreadySeen = sessionStorage.getItem(sessionKey) === identity;
  if (!alreadySeen) sessionStorage.setItem(sessionKey, identity);
  return !optedOut && !alreadySeen;
};

export const clearWorkspaceGuideSession = () => {
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(SESSION_KEY_PREFIX)) sessionStorage.removeItem(key);
  }
};
