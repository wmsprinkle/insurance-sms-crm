import {
	hasSignInAllowList,
	isWorkspaceEmail,
	primaryWorkspaceDomain,
} from "./workspace";

export type SignInCandidate = {
	email: string | null | undefined;
	emailVerified: boolean | null | undefined;
};

export type SignInVerdict = { ok: true } | { ok: false; message: string };

export function checkSignIn(candidate: SignInCandidate): SignInVerdict {
	if (!hasSignInAllowList()) {
		return {
			ok: false,
			message:
				'No one can sign in yet: set ALLOWED_SIGN_IN in .env to your email domain (for example ALLOWED_SIGN_IN="acme.com") and restart.',
		};
	}

	if (candidate.emailVerified !== true) {
		return {
			ok: false,
			message:
				"The sign-in provider did not confirm this email address. Verify it with the provider and try again.",
		};
	}

	if (!isWorkspaceEmail(candidate.email)) {
		const domain = primaryWorkspaceDomain();
		return {
			ok: false,
			message: domain
				? `This CRM is private. Sign in with your @${domain} account.`
				: "This CRM is private. That address is not on the allow-list.",
		};
	}

	return { ok: true };
}
