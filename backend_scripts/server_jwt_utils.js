// Middleware to verify JWT token
const authenticateJWT = (req, res, next) => {
  const token = req.cookies.jwt;

  if (token) {
    jwt.verify(token, process.env.JWT_ACCESS_TOKEN_SECRET, (err, user) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({ message: 'Token expired' });
        }
        return res.sendStatus(403); // Forbidden if token is invalid
      }

      req.user = user;
      next();
    });
  } else {
    return res.status(401).json({ message: 'Token not available' });
  }
};

// Middleware to check if the user has the required role
const authorizeRole = (role) => (req, res, next) => {
  if (req.user && req.user.role === role) {
    next();
  } else {
    res.status(403).json({ message: 'Forbidden' });
  }
};

// Store refresh token in OpenSearch
const storeRefreshToken = async (token, user_id) => {
  await client.index({
    index: 'refresh_tokens',
    body: {
      token,
      user_id,
      created_at: new Date()
    }
  });
};
const generateAccessToken = (user) => {
  return jwt.sign(user, process.env.JWT_ACCESS_TOKEN_SECRET, { expiresIn: '1m' });
};
// Function to convert notebook to HTML

async function fetchNotebookContent(url) {
  const response = await fetch(url);
  if (response.ok) {
    return await response.text();
  }
  throw new Error('Failed to fetch the notebook');
}
async function convertNotebookToHtml(githubRepo, notebookPath, outputDir) {
  const notebookName = path.basename(notebookPath, '.ipynb');
  const timestamp = Date.now();
  const htmlOutputPath = path.join(outputDir, `${timestamp}-${notebookName}.html`);
  const branches = ['main', 'master'];

  let notebookContent;

  for (const branch of branches) {
    try {
      const notebookUrl = `${githubRepo}/raw/${branch}/${notebookPath}`;
      notebookContent = await fetchNotebookContent(notebookUrl);
      break;
    } catch (error) {
      console.log(`Failed to fetch from ${branch} branch. Trying next branch...`);
    }
  }

  if (!notebookContent) {
    console.log('Failed to fetch the notebook from both main and master branches');
    return null;
  }

  const notebookFilePath = path.join(outputDir, `${timestamp}-${notebookName}.ipynb`);
  fs.writeFileSync(notebookFilePath, notebookContent);

  try {
    await new Promise((resolve, reject) => {
      exec(`jupyter nbconvert --to html "${notebookFilePath}" --output "${htmlOutputPath}"`, (error, stdout, stderr) => {
        if (error) {
          reject(`Error converting notebook: ${stderr}`);
        } else {
          resolve();
        }
      });
    });
    return htmlOutputPath;
  } catch (error) {
    console.log(error);
    return null;
  }
}
