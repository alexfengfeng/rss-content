const http = require('http');

const req = http.get('http://localhost:3000/news', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    if (res.statusCode !== 200) {
      console.log('Response:', data.substring(0, 500));
    } else {
      console.log('OK - Page loaded successfully');
    }
  });
});

req.on('error', (err) => {
  console.error('Request failed:', err.message);
});

req.setTimeout(5000, () => {
  console.error('Request timeout');
  req.destroy();
});
