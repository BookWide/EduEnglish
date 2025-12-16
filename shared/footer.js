/* ========== BookWide Global Footer (Dark Theme) ========== */

:root{
  --bw-footer-bg: #0b1220;        /* 主黑底 */
  --bw-footer-bg-2: #060b14;      /* 更深黑（底部） */
  --bw-footer-text: #e5e7eb;      /* 主文字 */
  --bw-footer-muted: #9ca3af;     /* 次要文字 */
  --bw-footer-border: #1f2937;    /* 分隔線 */
  --bw-footer-accent: #4f8cff;    /* BookWide 藍 */
}

#bw-footer{
  margin-top: 64px;
}

/* 整體 */
.bw-footer{
  background: linear-gradient(
    180deg,
    var(--bw-footer-bg) 0%,
    #080f1d 100%
  );
  color: var(--bw-footer-text);
  font-size: 14px;
}

/* 內層寬度 */
.bw-footer__inner{
  max-width: 1200px;
  margin: 0 auto;
  padding: 48px 24px 36px;
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 48px;
}

/* ================= 左側品牌 ================= */

.bw-footer__brand{
  display: flex;
}

.bw-footer__logoBox{
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.bw-footer__tiny{
  font-size: 12px;
  color: var(--bw-footer-muted);
  letter-spacing: .08em;
}

.bw-footer__logo{
  font-size: 28px;
  font-weight: 800;
  letter-spacing: .02em;
  color: #ffffff;
}

/* 社群 icon */
.bw-footer__social{
  display: flex;
  gap: 12px;
  margin-top: 6px;
}

.bw-social{
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #111827;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--bw-footer-muted);
  transition: all .2s ease;
}

.bw-social:hover{
  background: var(--bw-footer-accent);
  color: #fff;
  transform: translateY(-2px);
}

/* ================= 右側連結 ================= */

.bw-footer__cols{
  display: flex;
  flex-direction: column;
  gap: 32px;
}

/* 上排：BookWide + 快捷 */
.bw-footer__row--top{
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px 28px;
}

.bw-footer__topTitle{
  font-size: 18px;
  font-weight: 700;
  color: #fff;
}

.bw-footer__topLinks a{
  margin-right: 18px;
  color: var(--bw-footer-text);
  text-decoration: none;
}

.bw-footer__topLinks a:hover{
  color: var(--bw-footer-accent);
}

/* 中段 grid */
.bw-footer__grid{
  display: grid;
  grid-template-columns: repeat(3, minmax(0,1fr));
  gap: 28px;
}

.bw-col--wide{
  grid-column: span 1;
}

.bw-col__title{
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 10px;
  color: #fff;
}

.bw-col__link{
  display: block;
  padding: 4px 0;
  color: var(--bw-footer-muted);
  text-decoration: none;
  line-height: 1.6;
}

.bw-col__link:hover{
  color: var(--bw-footer-accent);
}

/* 外連箭頭 */
.bw-ext{
  margin-left: 4px;
  font-size: 12px;
  opacity: .8;
}

/* ================= 底部公司資訊 ================= */

.bw-footer__bottom{
  background: var(--bw-footer-bg-2);
  border-top: 1px solid var(--bw-footer-border);
  padding: 18px 16px;
  text-align: center;
}

.bw-footer__bottomLine{
  font-size: 12px;
  color: var(--bw-footer-muted);
  line-height: 1.6;
}

.bw-footer__bottom a{
  color: var(--bw-footer-text);
}

.bw-footer__bottom a:hover{
  color: var(--bw-footer-accent);
}

/* ================= RWD ================= */

@media (max-width: 900px){
  .bw-footer__inner{
    grid-template-columns: 1fr;
    gap: 36px;
  }
  .bw-footer__grid{
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 520px){
  .bw-footer__grid{
    grid-template-columns: 1fr;
  }
  .bw-footer__topLinks a{
    margin-right: 12px;
  }
}


