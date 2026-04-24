const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', require('./routes/api'));

// SPA fallback - serve index.html for all non-API routes
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🏀 PH Hoops running at http://localhost:${PORT}`);
  console.log(`   Admin demo codes: SRC2025 (San Roque) · MKN2025 (Marikina)`);
  console.log(`   Press Ctrl+C to stop\n`);
});
