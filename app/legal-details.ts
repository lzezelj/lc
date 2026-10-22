import "server-only";

export type LegalDetails = {
  name: string;
  streetAddress: string;
  postalCity: string;
  country: string;
  email: string;
};

function legalValue(name: string, label: string) {
  return process.env[name]?.trim() || `[Configure ${label}]`;
}

export function getLegalDetails(): LegalDetails {
  return {
    name: legalValue("LEGAL_NAME", "LEGAL_NAME"),
    streetAddress: legalValue("LEGAL_STREET_ADDRESS", "LEGAL_STREET_ADDRESS"),
    postalCity: legalValue("LEGAL_POSTAL_CITY", "LEGAL_POSTAL_CITY"),
    country: legalValue("LEGAL_COUNTRY", "LEGAL_COUNTRY"),
    email: legalValue("LEGAL_EMAIL", "LEGAL_EMAIL"),
  };
}
