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
	},
	webpack: (config) => {
		config.ignoreWarnings = [
			...(config.ignoreWarnings || []),
			// Windows path casing (C:\ vs c:\) can trigger noisy cache dependency warnings.
			(warning) =>
				typeof warning?.message === 'string' &&
				warning.message.includes("webpack.cache.PackFileCacheStrategy/webpack.FileSystemInfo") &&
				warning.message.includes("Resolving '../../../typescript/lib/typescript'")
		];
		return config;
	}
};

export default nextConfig;
