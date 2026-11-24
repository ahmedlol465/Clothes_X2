/** User serialisation helpers. */
'use strict';

function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

module.exports = { publicUser };
