/** @type {import('next').NextConfig} */
const nextConfig = {
	images: {
		remotePatterns: [
			{ protocol: 'http', hostname: 'localhost', port: '5000', pathname: '/**' },
			{ protocol: 'http', hostname: '127.0.0.1', port: '5000', pathname: '/**' },
			{ protocol: 'http', hostname: 'localhost', port: '4000', pathname: '/**' },
			{ protocol: 'http', hostname: '127.0.0.1', port: '4000', pathname: '/**' },
			{ protocol: 'https', hostname: 'res.cloudinary.com', pathname: '/**' },
			// Dev-friendly fallback for other remote sources used by marketing content.
			{ protocol: 'https', hostname: '**', pathname: '/**' },
			{ protocol: 'http', hostname: '**', pathname: '/**' }
		]
	}
};

export default nextConfig;
