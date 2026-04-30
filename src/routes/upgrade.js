const express = require('express');
const router = express.Router();

// Subscription feature disabled for now — will be added later with PayMongo
router.get('/upgrade', (req, res) => {
  res.redirect('/admin');
});

module.exports = router;
