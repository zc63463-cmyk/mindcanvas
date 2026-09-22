<!--
centers:
  - at: "node:发布验收根/甲中心"
    cid: c1
    dir: right
    x: -900
    y: 0
  - at: "node:发布验收根/乙中心"
    cid: c2
    dir: right
    x: 900
    y: 0
  - at: "node:发布验收根/甲中心/甲内嵌套中心"
    cid: c6
    dir: right
    x: -300
    y: 620
edges:
  - from: "cid:c7"
    to: "cid:c4"
    rel: relates-to
    source: manual
-->

# 发布验收根

<!--
cid: c1
-->

## 甲中心

### 甲框内一

### 甲框内二

<!--
cid: c3
-->

#### 甲挂出一

##### 甲挂出子一

<!--
cid: c6
-->

### 甲内嵌套中心

#### 甲内嵌套子一

<!--
cid: c8
frame: "{\"version\":1,\"depth\":1}"
-->

### 甲内成框

<!--
cid: c7
-->

#### 甲内框子一

##### 甲内框挂出一

<!--
cid: c2
-->

## 乙中心

### 乙框内一

### 乙框内二

<!--
cid: c4
-->

#### 乙挂出一
