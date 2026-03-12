const HID = require('node-hid');
const notifier = require('node-notifier');

// 根据诊断结果，使用正确的设备路径（设备 3）
const DEVICE_PATH = "\\\\?\\HID#VID_5253&PID_1021&MI_02&Col02#7&31f68367&0&0001#{4d1e55b2-f16f-11cf-88cb-001111000030}";

let device;
try {
    device = new HID.HID(DEVICE_PATH);
    console.log('✅ 设备打开成功');
} catch (e) {
    console.error('❌ 打开设备失败:', e.message);
    console.log('请以管理员身份运行此脚本，并确保浏览器中未打开 MCHOSE HUB');
    process.exit(1);
}

const reportId = 0x11;
const dataPart = [0x06, ...Array(19).fill(0x00)];          // 原始命令数据
const sendData = dataPart.map(b => b ^ 0xFF);             // 取反后的数据部分
const sendBuffer = [reportId, ...sendData];                // 合并形式（包含报告 ID）

function toHex(arr) {
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

async function readBattery() {
    return new Promise((resolve, reject) => {
        try {
            device.sendFeatureReport(sendBuffer);
        } catch (e) {
            reject(new Error(`发送失败: ${e.message}`));
            return;
        }

        setTimeout(() => {
            try {
                const response = device.getFeatureReport(reportId, 64);
                if (!response || response.length === 0) {
                    reject(new Error('无响应'));
                    return;
                }

                console.log('原始响应:', toHex(response));

                // 对整个响应取反
                const raw = response.map(b => b ^ 0xFF);
                console.log('取反后:', toHex(raw));

                // 有效载荷从索引 2 开始（跳过报告 ID 和命令码）
                const payload = raw.slice(2);
                console.log('有效载荷:', toHex(payload));

                if (payload.length < 11) {
                    reject(new Error('响应长度不足'));
                    return;
                }

                // 根据解析器，电量在 payload[9]，充电状态在 payload[10]
                const battery = payload[9];
                const chargeStatus = payload[10];

                resolve({ battery, chargeStatus });
            } catch (e) {
                reject(e);
            }
        }, 200);
    });
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

    // 每 5 分钟轮询一次（可根据需要调整）
    setTimeout(pollBattery, 5 * 60 * 1000);
}

// 启动轮询
pollBattery();

// 程序退出时关闭设备
process.on('SIGINT', () => {
    device.close();
    console.log('程序退出');
    process.exit();
});