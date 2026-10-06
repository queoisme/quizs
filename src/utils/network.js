'use strict';
const os = require('os');
const { PORT, PUBLIC_URL } = require('../config');

/* IPv4 trong mạng LAN để điện thoại cùng Wi-Fi truy cập được (bỏ qua card mạng ảo) */
function lanAddress() {
  const skip = /^(docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|lo)/;
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (skip.test(name)) continue;
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return 'localhost';
}

const baseUrl = () => (PUBLIC_URL ? PUBLIC_URL.replace(/\/+$/, '') : `http://${lanAddress()}:${PORT}`);
const joinUrl = (pin) => `${baseUrl()}/?pin=${pin}`;

module.exports = { lanAddress, baseUrl, joinUrl };
