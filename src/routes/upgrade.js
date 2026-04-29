const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { generateToken } = require('../middleware/auth');
const db = require('../db/database');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'phhoops-jwt-secret-change-in-production';

router.get('/upgrade', requireAuth, (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upgrade to Pro | PH Hoops</title>
<link rel="stylesheet" href="/css/main.css"></head>
<body class="dark-bg">
<nav class="topnav">
  <div class="nav-brand"><a href="/" style="color:inherit;text-decoration:none">🏀 <span class="brand-text">PH HOOPS</span></a></div>
  <div class="nav-actions"><a href="/admin" class="btn-ghost-sm">← Back to Admin</a></div>
</nav>
<div class="upgrade-wrap">
  <div class="upgrade-inner">
    <div style="text-align:center;margin-bottom:40px">
      <div style="font-size:48px;margin-bottom:12px">⚡</div>
      <h1>Upgrade to Pro</h1>
      <p style="color:#666;font-size:15px">Everything you need to run professional local leagues</p>
    </div>
    <div class="pricing-grid" style="max-width:640px;margin:0 auto 40px">
      <div class="price-card">
        <div class="price-tier">Free</div>
        <div class="price-amount">₱0</div>
        <ul class="price-features">
          <li>✓ 1 league</li><li>✓ Up to 10 teams</li><li>✓ Up to 30 players</li>
          <li>✓ Public scoreboard</li><li>✓ Game scheduling</li><li>✓ Live score entry</li>
          <li class="dim">✗ PDF stat exports</li>
          <li class="dim">✗ Bracket generator</li>
          <li class="dim">✗ Multiple leagues</li>
        </ul>
        <a href="/admin" class="btn-ghost full">Current Plan</a>
      </div>
      <div class="price-card price-hot">
        <div class="price-badge">RECOMMENDED</div>
        <div class="price-tier">Pro</div>
        <div class="price-amount">₱199<small>/mo</small></div>
        <ul class="price-features">
          <li>✓ <b>Unlimited leagues</b></li>
          <li>✓ <b>Unlimited teams &amp; players</b></li>
          <li>✓ <b>PDF stat reports</b></li>
          <li>✓ <b>Bracket generator</b></li>
          <li>✓ Live score entry</li>
          <li>✓ Multiple scorers per league</li>
          <li>✓ Priority support</li>
        </ul>
        <!-- 
          TODO: Replace the button below with your payment integration.
          Recommended PH payment gateway: PayMongo (supports GCash, Maya, Credit Card)
          https://developers.paymongo.com/
          
          Steps to add payment:
          1. npm install axios (or use fetch)
          2. Create POST /upgrade/pay route that calls PayMongo API
          3. Handle webhook at POST /upgrade/webhook to confirm payment
          4. On confirmed payment: UPDATE users SET plan='pro' WHERE id=$1
        -->
        <button onclick="showPaymentInfo()" class="btn-primary full">Subscribe Now →</button>
        <div style="font-size:11px;color:#555;text-align:center;margin-top:10px">
          GCash · Maya · Credit/Debit Card
        </div>
      </div>
    </div>

    <div id="payment-info" style="display:none;max-width:500px;margin:0 auto;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:24px;text-align:center">
      <div style="font-size:20px;margin-bottom:12px">📱 How to Subscribe</div>
      <p style="color:#aaa;font-size:14px;margin-bottom:16px">Send ₱199 via GCash or Maya and we'll activate your Pro account within 24 hours.</p>
      <div style="background:rgba(255,107,53,.08);border:1px solid rgba(255,107,53,.25);border-radius:8px;padding:16px;margin-bottom:16px">
        <div style="font-size:12px;color:#888;margin-bottom:4px">GCASH / MAYA NUMBER</div>
        <div style="font-size:22px;font-weight:800;color:#ff6b35">09XX-XXX-XXXX</div>
        <div style="font-size:12px;color:#888;margin-top:4px">Account Name: Your Name Here</div>
      </div>
      <p style="color:#666;font-size:12px">After sending, email your screenshot to <b style="color:#aaa">admin@phhoops.ph</b> with your registered email address.</p>
    </div>

    <!-- Dev/demo only: activate Pro without payment -->
    ${process.env.NODE_ENV !== 'production' ? `
    <div style="margin-top:32px;text-align:center">
      <div style="font-size:11px;color:#333;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Development Only</div>
      <button onclick="activateDemoPro()" style="background:rgba(255,255,255,.05);border:1px dashed rgba(255,255,255,.15);color:#555;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:12px">
        Activate Pro (demo, no payment)
      </button>
    </div>` : ''}
  </div>
</div>
<script>
  function showPaymentInfo(){
    document.getElementById('payment-info').style.display='block';
    document.getElementById('payment-info').scrollIntoView({behavior:'smooth'});
  }
  async function activateDemoPro(){
    if(!confirm('Activate Pro for demo/testing?'))return;
    const r=await fetch('/upgrade/activate-demo',{method:'POST'});
    if(r.ok)location.href='/admin';else alert('Error');
  }
</script>
</body></html>`);
});

// TODO: Replace this with real PayMongo webhook confirmation in production
// This is only for development/demo testing
router.post('/upgrade/activate-demo', requireAuth, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }
  try {
    await db.run('UPDATE users SET plan=$1 WHERE id=$2', ['pro', req.user.id]);
    const user = await db.queryOne('SELECT * FROM users WHERE id=$1', [req.user.id]);
    req.session.token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, plan: user.plan },
      JWT_SECRET, { expiresIn: '30d' }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/*
  ─────────────────────────────────────────────────────────────────
  FUTURE: PayMongo Integration (add when ready to monetize)
  ─────────────────────────────────────────────────────────────────

  npm install axios

  router.post('/upgrade/pay', requireAuth, async (req, res) => {
    const axios = require('axios');
    const response = await axios.post('https://api.paymongo.com/v1/links', {
      data: {
        attributes: {
          amount: 19900,       // ₱199.00 in centavos
          description: 'PH Hoops Pro Plan - 1 Month',
          remarks: `user_id:${req.user.id}`,
        }
      }
    }, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(process.env.PAYMONGO_SECRET_KEY + ':').toString('base64'),
        'Content-Type': 'application/json',
      }
    });
    const checkoutUrl = response.data.data.attributes.checkout_url;
    res.json({ checkoutUrl });
  });

  router.post('/upgrade/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    // Verify webhook signature from PayMongo
    // On successful payment event, extract user_id from remarks and activate Pro:
    // await db.run('UPDATE users SET plan=$1 WHERE id=$2', ['pro', userId]);
    res.json({ received: true });
  });
*/

module.exports = router;
