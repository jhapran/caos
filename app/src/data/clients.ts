import type { Client, Firm } from './types';

export const FIRM: Firm = {
  name: 'Kumar Associates, Chartered Accountants',
  shortName: 'Kumar Associates',
  frn: '0123456W',
  city: 'Mumbai',
  fy: 'FY 2024-25',
  ay: 'AY 2025-26',
  team: [
    { id: 'u-pranav', name: 'CA Pranav Kumar', initials: 'PK', role: 'Partner' },
    { id: 'u-priya', name: 'Priya Nair', initials: 'PN', role: 'Manager' },
    { id: 'u-rahul', name: 'Rahul Verma', initials: 'RV', role: 'Senior Associate' },
    { id: 'u-neha', name: 'Neha Iyer', initials: 'NI', role: 'Associate' },
    { id: 'u-amit', name: 'Amit Shah', initials: 'AS', role: 'Associate' },
  ],
};

export const TEAM = FIRM.team;

export const CLIENTS: Client[] = [
  { id: 'c-abc', name: 'ABC Pvt Ltd', entityType: 'Pvt Ltd', city: 'Mumbai', industry: 'Manufacturing', turnoverBand: '₹25–100 Cr', ownerId: 'u-priya', tags: ['GST', 'TDS', 'Audit', 'MCA', 'ITR', 'Advance Tax', 'PF/ESI'], gstin: '27AABCA1234F1Z5', pan: 'AABCA1234F', cin: 'U74999MH2010PTC123456' },
  { id: 'c-xyz', name: 'XYZ LLP', entityType: 'LLP', city: 'Pune', industry: 'IT Services', turnoverBand: '₹5–25 Cr', ownerId: 'u-rahul', tags: ['GST', 'TDS', 'MCA', 'ITR'], gstin: '27AABFX9876K1Z2', pan: 'AABFX9876K' },
  { id: 'c-pqr', name: 'PQR Industries', entityType: 'Pvt Ltd', city: 'Thane', industry: 'Manufacturing', turnoverBand: '₹100–500 Cr', ownerId: 'u-priya', tags: ['GST', 'TDS', 'Audit', 'MCA', 'ITR', 'Advance Tax', 'PF/ESI'], gstin: '27AAACP5544R1Z8', pan: 'AAACP5544R', cin: 'U28999MH2008PTC223344' },
  { id: 'c-lmn', name: 'LMN Ltd', entityType: 'Ltd', city: 'Mumbai', industry: 'Trading', turnoverBand: '₹100–500 Cr', ownerId: 'u-pranav', tags: ['GST', 'TDS', 'Audit', 'MCA', 'ITR', 'Advance Tax'], gstin: '27AAACL2211M1Z4', pan: 'AAACL2211M', cin: 'L51909MH2001PLC131415' },
  { id: 'c-rst', name: 'RST Pvt Ltd', entityType: 'Pvt Ltd', city: 'Navi Mumbai', industry: 'Realty', turnoverBand: '₹25–100 Cr', ownerId: 'u-neha', tags: ['GST', 'TDS', 'MCA', 'ITR'], gstin: '27AAACR8899T1Z1', pan: 'AAACR8899T', cin: 'U70100MH2015PTC267890' },
  { id: 'c-kaveri', name: 'Kaveri Textiles Pvt Ltd', entityType: 'Pvt Ltd', city: 'Ichalkaranji', industry: 'Manufacturing', turnoverBand: '₹25–100 Cr', ownerId: 'u-rahul', tags: ['GST', 'TDS', 'Audit', 'MCA', 'ITR'], gstin: '27AABCK3322T1Z6', pan: 'AABCK3322T', cin: 'U17120MH2005PTC154321' },
  { id: 'c-deccan', name: 'Deccan Auto Components', entityType: 'Partnership', city: 'Aurangabad', industry: 'Manufacturing', turnoverBand: '₹5–25 Cr', ownerId: 'u-amit', tags: ['GST', 'TDS', 'ITR'], gstin: '27AAJFD4455A1Z9', pan: 'AAJFD4455A' },
  { id: 'c-nilgiri', name: 'Nilgiri Foods LLP', entityType: 'LLP', city: 'Mumbai', industry: 'Hospitality', turnoverBand: '₹5–25 Cr', ownerId: 'u-neha', tags: ['GST', 'TDS', 'MCA', 'ITR'], gstin: '27AAHFN6677N1Z3', pan: 'AAHFN6677N' },
  { id: 'c-trident', name: 'Trident Pharma Pvt Ltd', entityType: 'Pvt Ltd', city: 'Navi Mumbai', industry: 'Pharma', turnoverBand: '₹25–100 Cr', ownerId: 'u-priya', tags: ['GST', 'TDS', 'Audit', 'MCA', 'ITR', 'Advance Tax'], gstin: '27AAECT7788P1Z7', pan: 'AAECT7788P', cin: 'U24239MH2012PTC234567' },
  { id: 'c-aravali', name: 'Aravali Constructions', entityType: 'Partnership', city: 'Mumbai', industry: 'Realty', turnoverBand: '₹25–100 Cr', ownerId: 'u-rahul', tags: ['GST', 'TDS', 'ITR'], gstin: '27AAKFA1122C1Z5', pan: 'AAKFA1122C' },
  { id: 'c-bluelotus', name: 'Blue Lotus Hotels Pvt Ltd', entityType: 'Pvt Ltd', city: 'Goa', industry: 'Hospitality', turnoverBand: '₹5–25 Cr', ownerId: 'u-neha', tags: ['GST', 'TDS', 'MCA', 'ITR'], gstin: '30AAFCB9901L1Z2', pan: 'AAFCB9901L', cin: 'U55101GA2016PTC012345' },
  { id: 'c-sapphire', name: 'Sapphire Software Solutions', entityType: 'Pvt Ltd', city: 'Pune', industry: 'IT Services', turnoverBand: '₹5–25 Cr', ownerId: 'u-rahul', tags: ['GST', 'TDS', 'MCA', 'ITR', 'Advance Tax'], gstin: '27AALCS2233S1Z8', pan: 'AALCS2233S', cin: 'U72200PN2014PTC151515' },
  { id: 'c-meridian', name: 'Meridian Exports', entityType: 'Proprietorship', city: 'Mumbai', industry: 'Trading', turnoverBand: '₹1–5 Cr', ownerId: 'u-amit', tags: ['GST', 'ITR'], gstin: '27AHZPM5566M1Z4', pan: 'AHZPM5566M' },
  { id: 'c-crestpoint', name: 'Crestpoint Realty LLP', entityType: 'LLP', city: 'Thane', industry: 'Realty', turnoverBand: '₹25–100 Cr', ownerId: 'u-priya', tags: ['GST', 'TDS', 'MCA', 'ITR'], gstin: '27AAOFC3344R1Z1', pan: 'AAOFC3344R' },
  { id: 'c-sunrise', name: 'Sunrise Education Trust', entityType: 'Trust', city: 'Mumbai', industry: 'NGO', turnoverBand: '< ₹1 Cr', ownerId: 'u-neha', tags: ['ITR', 'Audit'], pan: 'AAATS4455S' },
  { id: 'c-vedant', name: 'Vedant Alloys Pvt Ltd', entityType: 'Pvt Ltd', city: 'Kolhapur', industry: 'Manufacturing', turnoverBand: '₹25–100 Cr', ownerId: 'u-rahul', tags: ['GST', 'TDS', 'Audit', 'MCA', 'ITR', 'PF/ESI'], gstin: '27AABCV5566V1Z6', pan: 'AABCV5566V', cin: 'U27109MH2009PTC198765' },
  { id: 'c-palm', name: 'Palm Court Hospitality', entityType: 'Partnership', city: 'Alibaug', industry: 'Hospitality', turnoverBand: '₹1–5 Cr', ownerId: 'u-amit', tags: ['GST', 'TDS', 'ITR'], gstin: '27AAZFP6677P1Z3', pan: 'AAZFP6677P' },
  { id: 'c-quickmed', name: 'Quickmed Diagnostics Pvt Ltd', entityType: 'Pvt Ltd', city: 'Mumbai', industry: 'Pharma', turnoverBand: '₹5–25 Cr', ownerId: 'u-priya', tags: ['GST', 'TDS', 'MCA', 'ITR'], gstin: '27AAQCQ7788Q1Z9', pan: 'AAQCQ7788Q', cin: 'U85195MH2018PTC312345' },
  { id: 'c-northstar', name: 'Northstar Logistics', entityType: 'Partnership', city: 'Bhiwandi', industry: 'Trading', turnoverBand: '₹5–25 Cr', ownerId: 'u-amit', tags: ['GST', 'TDS', 'ITR'], gstin: '27AAXFN8899N1Z2', pan: 'AAXFN8899N' },
  { id: 'c-indus', name: 'Indus Craft Exports Pvt Ltd', entityType: 'Pvt Ltd', city: 'Mumbai', industry: 'Trading', turnoverBand: '₹25–100 Cr', ownerId: 'u-rahul', tags: ['GST', 'TDS', 'Audit', 'MCA', 'ITR'], gstin: '27AADCI9900I1Z5', pan: 'AADCI9900I', cin: 'U51909MH2011PTC221100' },
  { id: 'c-greenfield', name: 'Greenfield Agro Producer Co', entityType: 'Pvt Ltd', city: 'Nashik', industry: 'Manufacturing', turnoverBand: '₹5–25 Cr', ownerId: 'u-neha', tags: ['GST', 'TDS', 'MCA', 'ITR'], gstin: '27AAHCG1010G1Z8', pan: 'AAHCG1010G', cin: 'U01122MH2016PTC287654' },
  { id: 'c-astra', name: 'Astra Cloud Technologies', entityType: 'Pvt Ltd', city: 'Pune', industry: 'IT Services', turnoverBand: '₹25–100 Cr', ownerId: 'u-rahul', tags: ['GST', 'TDS', 'MCA', 'ITR', 'Advance Tax'], gstin: '27AAOCA1212A1Z4', pan: 'AAOCA1212A', cin: 'U72900PN2019PTC186420' },
  { id: 'c-hopewell', name: 'Hopewell Welfare Foundation', entityType: 'Trust', city: 'Mumbai', industry: 'NGO', turnoverBand: '< ₹1 Cr', ownerId: 'u-neha', tags: ['ITR', 'Audit'], pan: 'AAATH1313H' },
  { id: 'c-rajhans', name: 'Rajhans Jewellers', entityType: 'Partnership', city: 'Mumbai', industry: 'Trading', turnoverBand: '₹5–25 Cr', ownerId: 'u-amit', tags: ['GST', 'TDS', 'ITR'], gstin: '27AAVFR1414J1Z1', pan: 'AAVFR1414J' },
  { id: 'c-orion', name: 'Orion Packaging Pvt Ltd', entityType: 'Pvt Ltd', city: 'Silvassa', industry: 'Manufacturing', turnoverBand: '₹5–25 Cr', ownerId: 'u-rahul', tags: ['GST', 'TDS', 'MCA', 'ITR'], gstin: '26AACCO1515O1Z7', pan: 'AACCO1515O', cin: 'U25202DN2013PTC004455' },
  { id: 'c-seagull', name: 'Seagull Marine Services', entityType: 'Proprietorship', city: 'Mumbai', industry: 'Trading', turnoverBand: '₹1–5 Cr', ownerId: 'u-amit', tags: ['GST', 'ITR'], gstin: '27BXZPS1616S1Z3', pan: 'BXZPS1616S' },
  { id: 'c-trailblazer', name: 'Trailblazer Treks LLP', entityType: 'LLP', city: 'Pune', industry: 'Hospitality', turnoverBand: '< ₹1 Cr', ownerId: 'u-neha', tags: ['GST', 'MCA', 'ITR'], gstin: '27AAUFT1717T1Z6', pan: 'AAUFT1717T' },
  { id: 'c-medplus', name: 'Medplus Lifesciences', entityType: 'Partnership', city: 'Mumbai', industry: 'Pharma', turnoverBand: '₹5–25 Cr', ownerId: 'u-priya', tags: ['GST', 'TDS', 'ITR'], gstin: '27AAWFM1818L1Z2', pan: 'AAWFM1818L' },
  { id: 'c-cascade', name: 'Cascade Water Systems Pvt Ltd', entityType: 'Pvt Ltd', city: 'Thane', industry: 'Manufacturing', turnoverBand: '₹1–5 Cr', ownerId: 'u-amit', tags: ['GST', 'TDS', 'MCA', 'ITR'], gstin: '27AAXCC1919W1Z9', pan: 'AAXCC1919W', cin: 'U41000MH2020PTC345678' },
  { id: 'c-zenith', name: 'Zenith Advisors LLP', entityType: 'LLP', city: 'Mumbai', industry: 'IT Services', turnoverBand: '₹1–5 Cr', ownerId: 'u-rahul', tags: ['GST', 'TDS', 'MCA', 'ITR'], gstin: '27AATFZ2020Z1Z5', pan: 'AATFZ2020Z' },
  { id: 'c-umang', name: 'Umang Mahila Foundation', entityType: 'Trust', city: 'Thane', industry: 'NGO', turnoverBand: '< ₹1 Cr', ownerId: 'u-neha', tags: ['ITR'], pan: 'AAATU2121U' },
  { id: 'c-harbourline', name: 'Harbourline Trading Co', entityType: 'Partnership', city: 'Mumbai', industry: 'Trading', turnoverBand: '₹5–25 Cr', ownerId: 'u-amit', tags: ['GST', 'TDS', 'ITR'], gstin: '27AAHFH2222H1Z8', pan: 'AAHFH2222H' },
  { id: 'c-pixelworks', name: 'Pixelworks Studio Pvt Ltd', entityType: 'Pvt Ltd', city: 'Mumbai', industry: 'IT Services', turnoverBand: '₹1–5 Cr', ownerId: 'u-rahul', tags: ['GST', 'TDS', 'MCA', 'ITR'], gstin: '27AAPCP2323P1Z4', pan: 'AAPCP2323P', cin: 'U92111MH2021PTC356789' },
  { id: 'c-copperpot', name: 'Copper Pot Cloud Kitchen', entityType: 'Proprietorship', city: 'Pune', industry: 'Hospitality', turnoverBand: '< ₹1 Cr', ownerId: 'u-amit', tags: ['GST', 'ITR'], gstin: '27CZQPK2424C1Z1', pan: 'CZQPK2424C' },
];

export function getClient(id: string): Client | undefined {
  return CLIENTS.find((c) => c.id === id);
}

export function ownerOf(id: string) {
  return TEAM.find((t) => t.id === id) ?? TEAM[0];
}
