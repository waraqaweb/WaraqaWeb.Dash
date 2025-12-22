import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PREVIEW_COOKIE = 'waraqa_marketing_preview';
const PREVIEW_TOKEN_COOKIE = 'waraqa_marketing_preview_token';

export const middleware = (request: NextRequest) => {
  const url = request.nextUrl;
  const preview = url.searchParams.get('preview');
  const token = url.searchParams.get('token');

  if (preview !== '1') {
    return NextResponse.next();
  }

  const expectedToken = process.env.MARKETING_PREVIEW_TOKEN;
  const tokenOk = expectedToken ? Boolean(token) && token === expectedToken : process.env.NODE_ENV !== 'production';

  if (!tokenOk) {
    return NextResponse.next();
  }

  const nextUrl = url.clone();
  nextUrl.searchParams.delete('preview');
  nextUrl.searchParams.delete('token');

  const response = NextResponse.redirect(nextUrl);
  response.cookies.set(PREVIEW_COOKIE, '1', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 30,
    path: '/'
  });
  if (token) {
    response.cookies.set(PREVIEW_TOKEN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 30,
      path: '/'
    });
  }

  return response;
};

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
