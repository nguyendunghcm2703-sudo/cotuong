// Worker: phục vụ file tĩnh trong public/ và chuyển kết nối /ws/<MÃ> tới đúng phòng cờ.

import { Room } from './room.js';

export { Room };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = /^\/ws\/([A-Za-z0-9]{4,12})$/.exec(url.pathname);

    if (m) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Cần kết nối WebSocket', { status: 426 });
      }
      // Chỉ nhận kết nối từ chính trang web này, chặn trang lạ dùng ké server.
      const origin = request.headers.get('Origin');
      if (origin) {
        let host = '';
        try {
          host = new URL(origin).host;
        } catch (e) {
          /* origin hỏng */
        }
        if (host !== url.host) return new Response('Không được phép', { status: 403 });
      }
      const id = env.ROOMS.idFromName(m[1].toUpperCase());
      return env.ROOMS.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
