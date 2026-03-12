const HID = require('node-hid');
const notifier = require('node-notifier');

// 解析命令行参数
const args = process.argv.slice(2);
const DEBUG = args.includes('-d');
const TEST_NOTIFY = args.includes('-t');

function showHelp() {
    console.log(`
MCHOSE A7 电池电量监控器
用法: node check_battery.js [选项]

选项:
  -d      启用调试输出，显示详细通信数据
  -t      发送测试通知，检查通知功能是否正常
  -h      显示本帮助信息

示例:
  node check_battery.js          # 正常监控模式
  node check_battery.js -d       # 监控并显示调试信息
  node check_battery.js -t       # 仅测试通知
    `);
}

if (args.includes('-h') || args.includes('--help')) {
    showHelp();
    process.exit(0);
}

if (TEST_NOTIFY) {
    notifier.notify({
        title: 'MCHOSE 电量监控 - 测试通知',
        message: '如果你看到这条消息，说明通知功能正常',
        sound: true,
        wait: false
    });
    console.log('测试通知已发送，请检查通知中心。');
    process.exit(0);
}

const VENDOR_ID = 21075;
const PRODUCT_ID = 4129;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function debugLog(...msg) {
    if (DEBUG) console.log('[DEBUG]', ...msg);
}

async function findWorkingDevicePath() {
    const devices = HID.devices().filter(d => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID);
    if (devices.length === 0) {
        throw new Error('未找到匹配的鼠标设备，请确认接收器已插入');
    }

    const reportId = 0x11;
    const dataPart = [0x06, ...Array(19).fill(0x00)];
    const sendData = dataPart.map(b => b ^ 0xFF);
    const sendBuffer = [reportId, ...sendData];

    for (const devInfo of devices) {
        debugLog(`尝试设备: ${devInfo.path} (接口 ${devInfo.interface}, 用法页 ${devInfo.usagePage})`);
        let device;
        try {
            device = new HID.HID(devInfo.path);
        } catch (e) {
            debugLog(`  打开失败: ${e.message}`);
            continue;
        }

        try {
            device.sendFeatureReport(sendBuffer);
            debugLog('  命令发送成功');
        } catch (e) {
            debugLog(`  发送失败: ${e.message}`);
            device.close();
            continue;
        }

        await sleep(200);

        let response;
        try {
            response = device.getFeatureReport(reportId, 64);
        } catch (e) {
            debugLog(`  接收失败: ${e.message}`);
            device.close();
            continue;
        }

        if (response && response.length > 0) {
            const raw = response.map(b => b ^ 0xFF);
            const payload = raw.slice(2);
            debugLog(`  取反后有效载荷: ${payload.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

            if (payload.length >= 11) {
                const battery = payload[9];
                const chargeStatus = payload[10];
                if (battery >= 0 && battery <= 100 && (chargeStatus === 0 || chargeStatus === 1)) {
                    console.log(`✅ 工作设备已找到！电量: ${battery}%, 充电状态: ${chargeStatus}`);
                    device.close();
                    return devInfo.path;
                }
            }
        }
        device.close();
    }
    throw new Error('未能找到可正常通信的设备，请以管理员身份运行并关闭浏览器中的 MCHOSE HUB');
}

(async () => {
    try {
        const devicePath = await findWorkingDevicePath();
        console.log('使用设备路径:', devicePath);
        const device = new HID.HID(devicePath);
        console.log('设备打开成功，开始监控电量...');
        console.log('监控已启动，每5分钟检查一次电量...\n');

        const reportId = 0x11;
        const dataPart = [0x06, ...Array(19).fill(0x00)];
        const sendData = dataPart.map(b => b ^ 0xFF);
        const sendBuffer = [reportId, ...sendData];

        function toHex(arr) {
            return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(' ');
        }

        // 带重试的读取函数
        async function readBattery(retries = 3) {
            for (let attempt = 1; attempt <= retries; attempt++) {
                try {
                    device.sendFeatureReport(sendBuffer);
                } catch (e) {
                    if (attempt === retries) throw new Error(`发送失败: ${e.message}`);
                    await sleep(200 * attempt);
                    continue;
                }

                await sleep(200 * attempt); // 逐渐增加延时

                try {
                    const response = device.getFeatureReport(reportId, 64);
                    if (!response || response.length === 0) {
                        if (attempt === retries) throw new Error('无响应');
                        await sleep(200);
                        continue;
                    }

                    const raw = response.map(b => b ^ 0xFF);
                    if (DEBUG) {
                        console.log('[DEBUG] 原始响应:', toHex(response));
                        console.log('[DEBUG] 取反后:', toHex(raw));
                    }

                    const payload = raw.slice(2);
                    if (payload.length < 11) {
                        if (attempt === retries) throw new Error('响应长度不足');
                        continue;
                    }

                    const battery = payload[9];
                    const chargeStatus = payload[10];

                    if (battery >= 0 && battery <= 100 && (chargeStatus === 0 || chargeStatus === 1)) {
                        return { battery, chargeStatus };
                    } else {
                        debugLog(`  无效数据: battery=${battery}, chargeStatus=${chargeStatus}，重试...`);
                        if (attempt === retries) throw new Error('无效的电量数据');
                    }
                } catch (e) {
                    if (attempt === retries) throw e;
                }
                await sleep(200);
            }
            throw new Error('读取失败');
        }

        async function pollBattery() {
            try {
                const { battery, chargeStatus } = await readBattery();
                console.log(`🔋 电量: ${battery}% | 充电状态: ${chargeStatus === 1 ? '⚡充电中' : '未充电'}`);
                if (battery <= 20 && chargeStatus !== 1) {
                    notifier.notify({
                        title: '鼠标电量低',
                        message: `当前电量 ${battery}%，请及时充电`,
                        sound: true,
                        wait: false
                    });
                }
            } catch (err) {
                console.error('❌ 读取失败:', err.message);
            }
            setTimeout(pollBattery, 5 * 60 * 1000);
        }

        pollBattery();

        process.on('SIGINT', () => {
            device.close();
            console.log('程序退出');
            process.exit();
        });

    } catch (err) {
        console.error('初始化失败:', err.message);
        process.exit(1);
    }
})();