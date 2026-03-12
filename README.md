# MaiCong-A7-Check-Battery

自用迈从A7低电量提醒

# 记录过程

使用迈从网页驱动

https://www.mchose.com.cn/#/connectDevice

F12 - Application - Local Storge - deviceInfoMap 中包含电量

检查 sources , index-DKyxrLME.js 包含 deviceInfoMap, 找到方法 Pe , 其位于 index-C_l9y3E1.js:
```js
const J9 = async (n, e) => {
    if (LK())
        return console.log("isG3Mouse"),
        !1;
    const t = xoe;
    $E[t] = !0, ...
```