/**
 * Tabbit CDP - 人类行为模拟模块
 * 随机延迟、自然鼠标移动、拟人滚动，降低自动化检测风险。
 * 对标 go-rod/stealth 的行为层反检测。
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 随机延迟 [min, max] ms */
function randomDelay(min = 300, max = 800) {
  return sleep(min + Math.random() * (max - min));
}

/** 随机整数 [min, max] */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 自然鼠标移动：从当前位置到目标，带贝塞尔曲线和随机抖动
 * @param {object} session - CDP session
 * @param {number} toX - 目标 X
 * @param {number} toY - 目标 Y
 */
async function naturalMouseMove(session, toX, toY) {
  // 生成 8-15 个中间点，用二次贝塞尔曲线
  const steps = randInt(8, 15);
  const points = [];
  // 控制点（随机偏移）
  const cpX = (toX * 0.3 + Math.random() * 100 - 50);
  const cpY = (toY * 0.3 + Math.random() * 100 - 50);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * cpX + t * t * toX + (Math.random() - 0.5) * 3;
    const y = (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * cpY + t * t * toY + (Math.random() - 0.5) * 3;
    points.push({ x: Math.round(x), y: Math.round(y) });
  }

  for (const p of points) {
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await sleep(randInt(5, 25)); // 不均匀间隔
  }
}

/**
 * 自然点击：先移动鼠标到目标附近，再点击
 * @param {object} session - CDP session
 * @param {number} x - 目标 X
 * @param {number} y - 目标 Y
 */
async function naturalClick(session, x, y) {
  // 在目标附近随机偏移 ±3px
  const targetX = x + (Math.random() - 0.5) * 6;
  const targetY = y + (Math.random() - 0.5) * 6;
  await naturalMouseMove(session, targetX, targetY);
  await randomDelay(50, 150);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: targetX, y: targetY, button: 'left', clickCount: 1,
  });
  await randomDelay(30, 100);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: targetX, y: targetY, button: 'left', clickCount: 1,
  });
}

/**
 * 自然输入：逐字符输入，带随机间隔
 * @param {object} session - CDP session
 * @param {string} text - 输入文本
 * @param {object} options - { minDelay: 30, maxDelay: 120 }
 */
async function naturalType(session, text, options = {}) {
  const minDelay = options.minDelay || 30;
  const maxDelay = options.maxDelay || 120;
  for (const char of text) {
    await session.send('Input.insertText', { text: char });
    await sleep(randInt(minDelay, maxDelay));
  }
}

/**
 * 自然滚动：模拟人类浏览行为，随机距离和速度
 * @param {object} session - CDP session
 * @param {string} direction - 'down' | 'up'
 * @param {number} times - 滚动次数
 */
async function naturalScroll(session, direction = 'down', times = 3) {
  const deltaY = direction === 'down' ? 1 : -1;
  for (let i = 0; i < times; i++) {
    const distance = randInt(100, 400);
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: randInt(200, 600), y: randInt(200, 400),
      deltaX: 0, deltaY: deltaY * distance,
    });
    await randomDelay(200, 600);
  }
}

/**
 * 模拟人类浏览：随机停留 + 滚动
 * @param {object} session - CDP session
 * @param {number} durationMs - 总停留时间 ms
 */
async function humanBrowse(session, durationMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    const action = Math.random();
    if (action < 0.5) {
      // 滚动
      await naturalScroll(session, Math.random() > 0.3 ? 'down' : 'up', randInt(1, 3));
    } else if (action < 0.8) {
      // 鼠标移动到随机位置
      await naturalMouseMove(session, randInt(100, 800), randInt(100, 600));
    }
    await randomDelay(500, 2000);
  }
}

module.exports = {
  sleep,
  randomDelay,
  randInt,
  naturalMouseMove,
  naturalClick,
  naturalType,
  naturalScroll,
  humanBrowse,
};
