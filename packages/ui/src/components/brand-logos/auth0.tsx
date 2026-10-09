import type * as React from "react";

const Auth0Logo = (props: React.SVGProps<SVGSVGElement>) => (
	<svg
		viewBox="0 0 24 24"
		xmlns="http://www.w3.org/2000/svg"
		aria-hidden="true"
		fill="currentColor"
		{...props}
	>
		<path d="M21.98 7.448 19.62 0H4.347L2.02 7.448c-1.352 4.312.03 9.206 3.815 12.015L12.007 24l6.157-4.552c3.755-2.81 5.182-7.688 3.815-12Zm-9.97 12.34L7.04 16.165c-2.136-1.572-3.034-4.368-2.205-6.9l.97-3.126h8.202l.97 3.126c.83 2.517-.06 5.329-2.2 6.9l-1.806 1.325Z" />
	</svg>
);

export default Auth0Logo;
