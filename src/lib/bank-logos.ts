import chase from '../assets/bank-logos/chase.svg'
import boa from '../assets/bank-logos/boa.svg'
import amex from '../assets/bank-logos/amex.svg'
import robinhood from '../assets/bank-logos/robinhood.svg'
import wellsFargo from '../assets/bank-logos/wells-fargo.svg'
import goldmanSachs from '../assets/bank-logos/goldman-sachs.svg'
import discover from '../assets/bank-logos/discover.svg'
import citi from '../assets/bank-logos/citi.svg'
import usBank from '../assets/bank-logos/us-bank.svg'
import capitalOne from '../assets/bank-logos/capital-one.svg'
import pnc from '../assets/bank-logos/pnc.svg'
import truist from '../assets/bank-logos/truist.svg'
import tdBank from '../assets/bank-logos/td-bank.svg'

/** Bundled locally so the bank picker never makes a runtime network request. */
export const bankLogos: Record<string, string> = {
  chase,
  boa,
  amex,
  robinhood,
  'wells-fargo': wellsFargo,
  'goldman-sachs': goldmanSachs,
  discover,
  citi,
  'us-bank': usBank,
  'capital-one': capitalOne,
  pnc,
  truist,
  'td-bank': tdBank,
}
