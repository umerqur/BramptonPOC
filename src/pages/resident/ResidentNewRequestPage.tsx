import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isSupabaseConfigured } from '../../lib/supabase'
import {
  ADDRESS_TYPES,
  METHOD_OF_CONTACT_OPTIONS,
  RESIDENT_DEMO_NOTICE,
  ACCEPTED_ATTACHMENT_HINT,
  ACCEPTED_ATTACHMENT_INPUT,
  MAX_ATTACHMENT_BYTES,
  isAcceptedAttachmentType,
  submitResidentRequest,
  type ResidentRequestInput,
} from '../../services/residentRequests'

type FormState = {
  requestType: string
  happeningNow: string
  description: string
  files: File[]
  addressType: string
  location: string
  concernUnitNumber: string
  city: string
  province: string
  concernPostalCode: string
  firstName: string
  lastName: string
  phone: string
  email: string
  methodOfContact: string
  resolutionFollowup: boolean
}

type BramptonServiceCategory = {
  label: string
  group: string
  summary: string
  whenToUse: string
  examples: string[]
  prompt: string
}

const INITIAL: FormState = {
  requestType: '',
  happeningNow: '',
  description: '',
  files: [],
  addressType: '',
  location: '',
  concernUnitNumber: '',
  city: 'Brampton',
  province: 'Ontario',
  concernPostalCode: '',
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  methodOfContact: '',
  resolutionFollowup: true,
}

const BRAMPTON_SERVICE_CATEGORIES: BramptonServiceCategory[] = [
  {
    label: 'Report Poorly Maintained Property',
    group: 'Property and yard standards',
    summary: 'Exterior property condition, debris, unsafe maintenance, or visible neglect.',
    whenToUse: 'Use this when a private property appears neglected and may need bylaw review.',
    examples: ['damaged fence', 'unsafe exterior condition', 'debris around a home'],
    prompt: 'Describe the visible condition, how long it has been present, and whether it affects nearby properties.',
  },
  {
    label: 'Report Excessive Refuse/Garbage on Private Property',
    group: 'Property and yard standards',
    summary: 'Garbage, refuse, or waste stored outside on private property.',
    whenToUse: 'Use this when garbage is accumulating on a private lot, driveway, side yard, or porch.',
    examples: ['overflowing bags', 'loose waste', 'garbage attracting pests'],
    prompt: 'Describe the type of refuse, where it is located, and how long it has been there.',
  },
  {
    label: 'Report Improper Storage of Garbage Containers',
    group: 'Property and yard standards',
    summary: 'Garbage bins or containers stored in a way that creates a nuisance or obstruction.',
    whenToUse: 'Use this when bins are repeatedly left out, blocking access, or creating a nuisance.',
    examples: ['bins left at curb', 'containers blocking sidewalk', 'overflowing containers'],
    prompt: 'Describe the container issue, where the containers are, and whether it is recurring.',
  },
  {
    label: 'Report An Overgrown Lawn Or Prohibited Plants On Private Property',
    group: 'Property and yard standards',
    summary: 'Long grass, weeds, overgrown yard conditions, or prohibited plants.',
    whenToUse: 'Use this for private property vegetation that appears unmanaged or prohibited.',
    examples: ['long grass', 'overgrown weeds', 'blocked sightline from plants'],
    prompt: 'Describe the vegetation concern and whether it blocks sidewalks, roads, or neighbouring properties.',
  },
  {
    label: 'Report Stagnant Water on Private Property',
    group: 'Property and yard standards',
    summary: 'Standing water on private property that may create nuisance or health concerns.',
    whenToUse: 'Use this when water is pooling and not draining after weather events.',
    examples: ['standing water in yard', 'water in containers', 'pooling near property line'],
    prompt: 'Describe where the water is, how long it remains, and whether it is creating odour or insects.',
  },
  {
    label: 'Report Long-term Rental Housing Concern – Unlicensed or Unregistered (e.g. basement apartment)',
    group: 'Housing and rentals',
    summary: 'Possible unlicensed or unregistered long term rental housing concern.',
    whenToUse: 'Use this when a rental unit may be operating without required licensing or registration.',
    examples: ['suspected unregistered basement unit', 'multiple separate units', 'rental activity concern'],
    prompt: 'Describe why the housing concern appears unlicensed or unregistered. Do not include private details you are unsure about.',
  },
  {
    label: 'Report Short-term Rental Housing Concern (e.g. AirBNB and VRBO)',
    group: 'Housing and rentals',
    summary: 'Possible short term rental concern related to a property.',
    whenToUse: 'Use this when short term rental activity appears to create a nuisance or licensing concern.',
    examples: ['frequent short stays', 'party house concern', 'parking from short term guests'],
    prompt: 'Describe the observed rental related concern, frequency, and any impact on the street.',
  },
  {
    label: 'Report an Encampment',
    group: 'Public space and community concern',
    summary: 'A tent, shelter, or encampment in a public space requiring city review.',
    whenToUse: 'Use this when a public space has an encampment concern needing coordinated review.',
    examples: ['tent in park', 'shelter near trail', 'items stored in public space'],
    prompt: 'Describe the location and visible site conditions without including personal details about individuals.',
  },
  {
    label: 'Report an Abandoned Shopping Cart',
    group: 'Public space and community concern',
    summary: 'Shopping cart left on public property, sidewalk, boulevard, or road area.',
    whenToUse: 'Use this when a cart has been abandoned and is obstructing or littering an area.',
    examples: ['cart on sidewalk', 'cart in park', 'cart in roadway shoulder'],
    prompt: 'Describe where the cart is and whether it is blocking a path, road, or access point.',
  },
  {
    label: 'Report an Incident of Dumping',
    group: 'Waste and dumping',
    summary: 'Dumped items, debris, garbage, or materials left illegally.',
    whenToUse: 'Use this when waste has been dumped on public or private land.',
    examples: ['mattress dumped', 'bags of waste', 'construction debris'],
    prompt: 'Describe what was dumped, the approximate amount, and where it is located.',
  },
  {
    label: 'Report Litter, Debris or Obstructions',
    group: 'Waste and dumping',
    summary: 'Litter, loose debris, or obstruction on public space.',
    whenToUse: 'Use this for debris that affects sidewalks, roads, boulevards, trails, or public areas.',
    examples: ['loose litter', 'branches blocking sidewalk', 'debris on boulevard'],
    prompt: 'Describe the debris or obstruction and whether it blocks safe travel.',
  },
  {
    label: 'Report of Landscaping/Construction/Dumpster Bin and other Materials on City Roadway',
    group: 'Roadway obstructions',
    summary: 'Bins, landscaping materials, construction materials, or stored items on a city roadway.',
    whenToUse: 'Use this when materials are placed on the road and may block traffic or create a hazard.',
    examples: ['dumpster bin on road', 'construction materials at curb', 'landscaping material pile'],
    prompt: 'Describe the material, where it is placed, and whether it blocks vehicles, cyclists, or pedestrians.',
  },
  {
    label: 'Report Mud-Tracking on City Roadways',
    group: 'Roadway obstructions',
    summary: 'Mud or dirt tracked onto public roads, often near construction activity.',
    whenToUse: 'Use this when roadway mud creates cleanliness, visibility, or safety concerns.',
    examples: ['mud from site entrance', 'dirt across lane', 'dirty roadway after trucks'],
    prompt: 'Describe the road segment, suspected source if visible, and how much of the road is affected.',
  },
  {
    label: 'Report Road Damage',
    group: 'Roads, sidewalks, and traffic',
    summary: 'General road damage that may require inspection or repair.',
    whenToUse: 'Use this when the road surface, curb lane, or roadway area is damaged.',
    examples: ['cracked roadway', 'sunken area', 'broken road edge'],
    prompt: 'Describe the damage, lane or direction if known, and whether it is creating a hazard.',
  },
  {
    label: 'Report Pothole',
    group: 'Roads, sidewalks, and traffic',
    summary: 'Pothole on a city road requiring repair review.',
    whenToUse: 'Use this for a specific pothole or cluster of potholes.',
    examples: ['deep pothole', 'multiple potholes', 'pothole near intersection'],
    prompt: 'Describe the pothole location, approximate size, and closest landmark or intersection.',
  },
  {
    label: 'Report Curb or Sidewalk Damage',
    group: 'Roads, sidewalks, and traffic',
    summary: 'Damaged curb or sidewalk that may affect pedestrian access.',
    whenToUse: 'Use this when a sidewalk or curb is broken, raised, cracked, or unsafe.',
    examples: ['raised sidewalk slab', 'broken curb', 'trip hazard'],
    prompt: 'Describe the curb or sidewalk damage and whether it affects pedestrians, wheelchairs, or strollers.',
  },
  {
    label: 'Report of Damage to City Sidewalk/Boulevard Curb',
    group: 'Roads, sidewalks, and traffic',
    summary: 'Damage to city sidewalk, boulevard, or curb area.',
    whenToUse: 'Use this for damage in the city owned boulevard or curb area.',
    examples: ['boulevard curb damage', 'sidewalk edge damage', 'curb cut concern'],
    prompt: 'Describe the damaged city asset and the exact frontage or nearby address.',
  },
  {
    label: 'Report an Uncleared/Icy Sidewalk',
    group: 'Roads, sidewalks, and traffic',
    summary: 'Sidewalk not cleared of snow or ice.',
    whenToUse: 'Use this after snowfall or freezing conditions when a sidewalk remains unsafe.',
    examples: ['icy sidewalk', 'snow not cleared', 'blocked pedestrian path'],
    prompt: 'Describe the sidewalk location and whether it is fully blocked or partially passable.',
  },
  {
    label: 'Report Snow Issues',
    group: 'Roads, sidewalks, and traffic',
    summary: 'Snow related service concern such as windrows, blocked access, or snow accumulation.',
    whenToUse: 'Use this for snow concerns not limited to a private sidewalk.',
    examples: ['blocked driveway windrow', 'snow pile blocking sightline', 'snow on road'],
    prompt: 'Describe the snow issue, when it occurred, and whether access or visibility is affected.',
  },
  {
    label: 'Report a Traffic Signal Issue',
    group: 'Roads, sidewalks, and traffic',
    summary: 'Traffic signal outage, timing issue, or malfunction.',
    whenToUse: 'Use this when a traffic light is not operating as expected.',
    examples: ['signal out', 'stuck red light', 'pedestrian signal not working'],
    prompt: 'Describe the intersection, signal direction, and what appears to be malfunctioning.',
  },
  {
    label: 'Street Light Repairs Needed',
    group: 'Roads, sidewalks, and traffic',
    summary: 'Street light outage, damaged pole, or lighting repair request.',
    whenToUse: 'Use this when a street light is out or visibly damaged.',
    examples: ['light out', 'flickering street light', 'damaged pole'],
    prompt: 'Describe the pole location, nearest address, and whether the light is out or flickering.',
  },
  {
    label: 'Report Active Speeding Concerns',
    group: 'Traffic calming',
    summary: 'Recurring speeding concern on a street or in a neighbourhood.',
    whenToUse: 'Use this when vehicles regularly appear to speed through an area.',
    examples: ['speeding near school', 'speeding on residential street', 'cut through traffic'],
    prompt: 'Describe the street segment, time of day, and pattern of speeding observed.',
  },
  {
    label: 'Request Speed Display Board and Traffic Calming Device',
    group: 'Traffic calming',
    summary: 'Request for speed display board or traffic calming review.',
    whenToUse: 'Use this when a location may need speed awareness or calming measures.',
    examples: ['speed board request', 'traffic calming request', 'school zone speeding'],
    prompt: 'Describe the speeding concern and why a board or calming device may help.',
  },
  {
    label: 'Report Damaged Trees',
    group: 'Trees and parks',
    summary: 'Tree damage requiring inspection or cleanup review.',
    whenToUse: 'Use this for damaged branches, storm damage, or visible tree damage.',
    examples: ['broken limb', 'storm damaged tree', 'split trunk'],
    prompt: 'Describe the damaged tree, whether branches are hanging, and whether the tree is on city or private property.',
  },
  {
    label: 'Report Dead or Unhealthy Trees',
    group: 'Trees and parks',
    summary: 'Dead, dying, or unhealthy tree concern.',
    whenToUse: 'Use this when a tree appears dead, diseased, or in poor condition.',
    examples: ['dead tree', 'no leaves', 'fungus or decay'],
    prompt: 'Describe the tree condition and where it is located.',
  },
  {
    label: 'Tree Debris Cleanup Required',
    group: 'Trees and parks',
    summary: 'Tree branches or debris requiring cleanup.',
    whenToUse: 'Use this for fallen branches or tree debris on public property.',
    examples: ['fallen branches', 'tree debris on boulevard', 'storm cleanup'],
    prompt: 'Describe the debris location and whether it blocks sidewalk, road, or access.',
  },
  {
    label: 'Tree Pruning or Removal Required',
    group: 'Trees and parks',
    summary: 'Tree pruning, trimming, or removal review request.',
    whenToUse: 'Use this when a city tree may need pruning or removal review.',
    examples: ['branches touching wires', 'low branches', 'tree blocking sign'],
    prompt: 'Describe why pruning or removal may be needed and what the tree is affecting.',
  },
  {
    label: 'Request New/Replacement Tree',
    group: 'Trees and parks',
    summary: 'Request a new or replacement tree.',
    whenToUse: 'Use this when a boulevard or public location may need a tree planted or replaced.',
    examples: ['replacement tree', 'missing boulevard tree', 'new tree request'],
    prompt: 'Describe where the new or replacement tree is requested and whether a previous tree was removed.',
  },
  {
    label: 'Report Dead or Damaged Sod',
    group: 'Trees and parks',
    summary: 'Dead or damaged sod in a public area or boulevard.',
    whenToUse: 'Use this when sod restoration may be needed.',
    examples: ['dead sod on boulevard', 'damaged grass after work', 'bare patch'],
    prompt: 'Describe the affected area and whether recent work or weather may have caused it.',
  },
  {
    label: 'Report Grass Cutting on City Property',
    group: 'Trees and parks',
    summary: 'Grass cutting request for city property.',
    whenToUse: 'Use this when city owned grass appears overdue for cutting.',
    examples: ['long grass in park', 'boulevard grass', 'city lot grass'],
    prompt: 'Describe the city property location and approximate height or extent of the grass.',
  },
  {
    label: 'Report Graffiti',
    group: 'Signs and graffiti',
    summary: 'Graffiti on public or private property requiring review or removal.',
    whenToUse: 'Use this when graffiti is visible on buildings, signs, benches, walls, or public assets.',
    examples: ['graffiti on wall', 'graffiti on sign', 'tagging on utility box'],
    prompt: 'Describe where the graffiti is and what type of surface it is on.',
  },
  {
    label: 'Report an Illegal/Junk Sign',
    group: 'Signs and graffiti',
    summary: 'Illegal, junk, temporary, or nuisance sign concern.',
    whenToUse: 'Use this when a sign appears unauthorized, abandoned, or obstructive.',
    examples: ['junk sign on boulevard', 'illegal advertising sign', 'temporary sign concern'],
    prompt: 'Describe the sign, where it is placed, and whether it blocks visibility or access.',
  },
  {
    label: 'Report Fireworks',
    group: 'Noise and nuisance',
    summary: 'Fireworks related nuisance or bylaw concern.',
    whenToUse: 'Use this for fireworks concerns that are not emergencies.',
    examples: ['fireworks late at night', 'recurring fireworks', 'debris after fireworks'],
    prompt: 'Describe when and where the fireworks concern occurred and whether it is recurring.',
  },
  {
    label: 'Report of Structures too Close to Property Line (Shed, decks etc.)',
    group: 'Zoning and structures',
    summary: 'Structure placement concern near a property line.',
    whenToUse: 'Use this when a shed, deck, or similar structure may be too close to a property line.',
    examples: ['shed near fence', 'deck setback concern', 'structure close to lot line'],
    prompt: 'Describe the structure, location on the lot, and why it appears too close to the property line.',
  },
  {
    label: 'Request a Parking Consideration',
    group: 'Parking and roads',
    summary: 'Request short term parking consideration.',
    whenToUse: 'Use this when temporary parking flexibility is being requested.',
    examples: ['overnight guests', 'temporary driveway work', 'short term parking need'],
    prompt: 'Describe the parking consideration needed, date, street, and number of vehicles.',
  },
]

const CATEGORY_GROUPS = Array.from(new Set(BRAMPTON_SERVICE_CATEGORIES.map((c) => c.group)))

const DEMO_COMPLAINTS: Array<Partial<FormState>> = [
  {
    requestType: 'Report Excessive Refuse/Garbage on Private Property',
    happeningNow: 'No',
    description:
      'Several garbage bags and loose household items have been stored along the side yard for about 3 weeks. Neighbours have noticed odour and animals near the property.',
    addressType: 'Street Address',
    location: '24 Main St N',
    concernPostalCode: 'L6V 1N6',
  },
  {
    requestType: 'Report an Incident of Dumping',
    happeningNow: 'Not sure',
    description:
      'A mattress, broken shelving, and several black garbage bags were dumped near the rear lane. The items are partly blocking access and have been there since the weekend.',
    addressType: 'Intersection',
    location: 'Queen St E & Kennedy Rd N',
    concernPostalCode: '',
  },
  {
    requestType: 'Report Active Speeding Concerns',
    happeningNow: 'Yes',
    description:
      'Vehicles are regularly speeding through this residential street during morning school drop off and again after 5 pm. Residents are concerned about children crossing nearby.',
    addressType: 'Intersection',
    location: 'Sandalwood Pkwy E & Dixie Rd',
    concernPostalCode: '',
  },
  {
    requestType: 'Report Poorly Maintained Property',
    happeningNow: 'No',
    description:
      'The front yard has broken fencing, scattered debris, and a damaged exterior stair area. The condition has not changed for over a month and appears to be getting worse.',
    addressType: 'Street Address',
    location: '100 Queen St W',
    concernPostalCode: 'L6X 1A4',
  },
  {
    requestType: 'Report Pothole',
    happeningNow: 'Yes',
    description:
      'There is a large pothole in the curb lane near the intersection. Drivers are swerving around it and water collects in it after rain.',
    addressType: 'Intersection',
    location: 'Bovaird Dr W & McLaughlin Rd N',
    concernPostalCode: '',
  },
  {
    requestType: 'Report an Uncleared/Icy Sidewalk',
    happeningNow: 'Yes',
    description:
      'The sidewalk in front of the property remains icy and hard to pass. Pedestrians are walking onto the road to get around it.',
    addressType: 'Street Address',
    location: '12 Vodden St E',
    concernPostalCode: 'L6V 1M2',
  },
  {
    requestType: 'Tree Debris Cleanup Required',
    happeningNow: 'Yes',
    description:
      'After the windstorm, several large branches fell onto the boulevard and part of the sidewalk. The debris is creating a tripping hazard.',
    addressType: 'Street Address',
    location: '58 Centre St N',
    concernPostalCode: 'L6V 1T4',
  },
  {
    requestType: 'Report Graffiti',
    happeningNow: 'No',
    description:
      'Graffiti has appeared on a utility box beside the sidewalk. It is visible from the road and has been there for several days.',
    addressType: 'Intersection',
    location: 'Steeles Ave E & Bramalea Rd',
    concernPostalCode: '',
  },
  {
    requestType: 'Report Short-term Rental Housing Concern (e.g. AirBNB and VRBO)',
    happeningNow: 'Not sure',
    description:
      'There are frequent weekend visitors, late night noise, and multiple cars connected to what appears to be a short term rental. The pattern has repeated for several weekends.',
    addressType: 'Street Address',
    location: '31 Creditview Rd',
    concernPostalCode: 'L6X 0G1',
  },
  {
    requestType: 'Street Light Repairs Needed',
    happeningNow: 'Yes',
    description:
      'The street light near the bus stop is flickering and sometimes completely off at night. The area is dark for pedestrians walking after sunset.',
    addressType: 'Street Address',
    location: '295 Queen St E',
    concernPostalCode: 'L6W 3R1',
  },
  {
    requestType: 'Report Mud-Tracking on City Roadways',
    happeningNow: 'Yes',
    description:
      'Mud is being tracked from a nearby site onto the road. The curb lane is dirty and slippery, especially after rain.',
    addressType: 'Intersection',
    location: 'Chinguacousy Rd & Williams Pkwy',
    concernPostalCode: '',
  },
  {
    requestType: 'Report an Illegal/Junk Sign',
    happeningNow: 'Yes',
    description:
      'Several temporary advertising signs have been placed on the boulevard near the intersection. They are distracting and one is partly blocking sightlines.',
    addressType: 'Intersection',
    location: 'Airport Rd & Countryside Dr',
    concernPostalCode: '',
  },
  {
    requestType: 'Report Stagnant Water on Private Property',
    happeningNow: 'No',
    description:
      'Water has been pooling in the side yard for several weeks and does not drain after rain. There is odour and insects around the pooled water.',
    addressType: 'Street Address',
    location: '76 Archdekin Dr',
    concernPostalCode: 'L6V 1Y4',
  },
  {
    requestType: 'Report of Structures too Close to Property Line (Shed, decks etc.)',
    happeningNow: 'No',
    description:
      'A new shed appears to have been built very close to the rear fence line. Neighbours are concerned it may not meet setback requirements.',
    addressType: 'Street Address',
    location: '44 Ray Lawson Blvd',
    concernPostalCode: 'L6Y 5L7',
  },
]

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; caseId: string; emailSent: boolean; attachmentsUploaded: number; attachmentError: boolean }
  | { kind: 'error'; message: string }

export default function ResidentNewRequestPage() {
  const [form, setForm] = useState<FormState>(INITIAL)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [formError, setFormError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [categoryQuery, setCategoryQuery] = useState('')
  const [activeGroup, setActiveGroup] = useState('All')

  const selectedCategory = BRAMPTON_SERVICE_CATEGORIES.find((c) => c.label === form.requestType)

  const visibleCategories = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase()
    return BRAMPTON_SERVICE_CATEGORIES.filter((category) => {
      const matchesGroup = activeGroup === 'All' || category.group === activeGroup
      const searchable = [category.label, category.group, category.summary, category.whenToUse, ...category.examples]
        .join(' ')
        .toLowerCase()
      return matchesGroup && (!q || searchable.includes(q))
    })
  }, [activeGroup, categoryQuery])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    if (formError) setFormError(null)
    if (status.kind === 'error') setStatus({ kind: 'idle' })
  }

  function chooseCategory(category: BramptonServiceCategory) {
    setForm((current) => ({
      ...current,
      requestType: category.label,
      description: current.description || '',
    }))
    setCategoryQuery(category.label)
    setFormError(null)
  }

  function fillDemoComplaint() {
    const scenario = DEMO_COMPLAINTS[Math.floor(Math.random() * DEMO_COMPLAINTS.length)]
    setForm((current) => ({
      ...current,
      ...scenario,
      city: 'Brampton',
      province: 'Ontario',
      firstName: current.firstName || 'Demo',
      lastName: current.lastName || 'Resident',
      email: current.email,
      phone: current.phone,
      methodOfContact: current.methodOfContact || 'Email',
      resolutionFollowup: true,
      files: [],
    }))
    setCategoryQuery(String(scenario.requestType ?? ''))
    setActiveGroup('All')
    setFormError(null)
    setFileError(null)
    if (status.kind === 'error') setStatus({ kind: 'idle' })
  }

  function handleSelectFiles(fileList: FileList | null) {
    const incoming = Array.from(fileList ?? [])
    const accepted: File[] = []
    const rejected: string[] = []
    for (const f of incoming) {
      if (!isAcceptedAttachmentType(f)) rejected.push(`${f.name} not supported`)
      else if (f.size > MAX_ATTACHMENT_BYTES) rejected.push(`${f.name} over 10 MB`)
      else accepted.push(f)
    }
    setForm((prev) => ({ ...prev, files: accepted }))
    setFileError(
      rejected.length > 0
        ? `These files were not added: ${rejected.join('; ')}. Accepted: ${ACCEPTED_ATTACHMENT_HINT}.`
        : null,
    )
    if (status.kind === 'error') setStatus({ kind: 'idle' })
  }

  function removeFile(index: number) {
    setForm((prev) => ({ ...prev, files: prev.files.filter((_, i) => i !== index) }))
  }

  function validate(): string | null {
    if (!form.requestType) return 'Please choose a service request type.'
    if (!form.happeningNow) return 'Please tell us whether this is happening now.'
    if (!form.description.trim()) return 'Please describe the issue so staff can review the request.'
    if (form.description.trim().length < 10) return 'Please provide a little more detail about the issue.'
    if (!form.addressType) return 'Please choose a type of address.'
    if (!form.location.trim()) return 'Please provide the address or nearest intersection.'
    if (!form.city.trim()) return 'Please provide a city.'
    if (!form.province.trim()) return 'Please provide a province.'
    if (!form.firstName.trim()) return 'Please enter your first name.'
    if (!form.lastName.trim()) return 'Please enter your last name.'
    if (!form.email.trim()) return 'Please enter a contact email address.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Please enter a valid email address.'
    if (!form.methodOfContact) return 'Please choose a method of contact.'
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const problem = validate()
    if (problem) {
      setFormError(problem)
      return
    }
    if (!isSupabaseConfigured) {
      setStatus({
        kind: 'error',
        message: 'The demo backend is not configured in this environment, so requests cannot be submitted right now.',
      })
      return
    }

    setStatus({ kind: 'submitting' })
    const input: ResidentRequestInput = {
      addressType: form.addressType,
      location: form.location,
      concernUnitNumber: form.concernUnitNumber || undefined,
      city: form.city,
      province: form.province,
      concernPostalCode: form.concernPostalCode || undefined,
      requestType: form.requestType,
      description: form.description.trim(),
      happeningNow: form.happeningNow || undefined,
      files: form.files,
      firstName: form.firstName,
      lastName: form.lastName,
      contactPostalCode: '',
      country: 'Canada',
      phone: form.phone,
      email: form.email,
      resolutionFollowup: form.resolutionFollowup,
      methodOfContact: form.methodOfContact,
    }
    try {
      const result = await submitResidentRequest(input)
      setStatus({
        kind: 'success',
        caseId: result.caseId,
        emailSent: result.emailSent,
        attachmentsUploaded: result.attachmentsUploaded,
        attachmentError: result.attachmentError,
      })
    } catch (err) {
      console.error('Resident request submission failed:', err)
      setStatus({
        kind: 'error',
        message: 'We could not submit the request. Please try again, or open the form in a signed out browser window.',
      })
    }
  }

  if (status.kind === 'success') {
    return (
      <div className="container-page py-12">
        <div className="mx-auto max-w-xl card p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-700">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-navy-900">Request submitted</h1>
          <p className="mt-2 text-sm text-ink-muted">Your service request has been submitted. Save your reference number to track it.</p>
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-ink-subtle">Reference number</div>
            <div className="mt-1 text-xl font-semibold tracking-wide text-navy-900">{status.caseId}</div>
          </div>
          {status.emailSent ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900">
              <div className="font-semibold">Email sent</div>
              <p className="mt-0.5">We sent a confirmation email. If you do not see it, please check your junk or spam folder.</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink-muted">Your request was recorded. The confirmation email could not be sent in this environment.</p>
          )}
          {status.attachmentError ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900">
              <div className="font-semibold">Some files were not uploaded</div>
              <p className="mt-0.5">
                Your request was saved
                {status.attachmentsUploaded > 0
                  ? ` with ${status.attachmentsUploaded} file${status.attachmentsUploaded === 1 ? '' : 's'}, but at least one attachment could not be uploaded.`
                  : ', but your attachments could not be uploaded.'}{' '}
                You can mention the photo when staff contact you.
              </p>
            </div>
          ) : status.attachmentsUploaded > 0 ? (
            <p className="mt-4 text-sm text-ink-muted">
              {status.attachmentsUploaded} file{status.attachmentsUploaded === 1 ? '' : 's'} uploaded and attached to your request for staff review.
            </p>
          ) : null}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link to={`/resident/status/${encodeURIComponent(status.caseId)}`} className="btn-primary">
              View request status
            </Link>
            <Link to="/resident" className="btn-secondary">
              Back to start
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container-page py-12">
      <div className="mx-auto max-w-3xl">
        <header>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">Create a service request</h1>
          <p className="mt-2 text-sm sm:text-base text-ink-muted">
            Search the same kinds of requests residents see in Brampton 311, then answer a few plain language questions.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 font-medium text-ink-muted">Demo form</span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 font-medium text-ink-muted">Do not enter real personal information</span>
          </div>
        </header>

        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-navy-900">Generate a realistic Brampton demo request</div>
              <p className="mt-0.5 text-xs text-ink-subtle">Creates a random property, road, tree, housing, dumping, sign, or traffic case. Your email is never autofilled.</p>
            </div>
            <button
              type="button"
              onClick={fillDemoComplaint}
              className="animate-demo-blink inline-flex items-center justify-center rounded-md bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-black focus:outline-none focus:ring-2 focus:ring-navy-900 focus:ring-offset-2"
            >
              Generate demo request
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Not for emergencies. If you need urgent help, contact your local police or dial 911.
        </div>

        <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
          <Section title="What do you need help with?" subtitle="Search or pick a Brampton style service request.">
            <Field label="Search service requests">
              <input
                type="search"
                value={categoryQuery}
                onChange={(e) => setCategoryQuery(e.target.value)}
                className={inputClass}
                placeholder="Try pothole, garbage, speeding, tree, sidewalk, rental, graffiti"
              />
            </Field>

            <div className="flex gap-2 overflow-x-auto pb-1">
              <FilterChip label="All" active={activeGroup === 'All'} onClick={() => setActiveGroup('All')} />
              {CATEGORY_GROUPS.map((group) => (
                <FilterChip key={group} label={group} active={activeGroup === group} onClick={() => setActiveGroup(group)} />
              ))}
            </div>

            <div className="grid max-h-[24rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {visibleCategories.map((category) => {
                const selected = form.requestType === category.label
                return (
                  <button
                    key={category.label}
                    type="button"
                    onClick={() => chooseCategory(category)}
                    className={`rounded-lg border p-3 text-left transition ${
                      selected
                        ? 'border-accent-500 bg-accent-50 ring-2 ring-accent-100'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-sm font-semibold text-navy-900">{category.label}</div>
                    <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">{category.group}</div>
                    <p className="mt-1 text-xs text-ink-muted">{category.summary}</p>
                  </button>
                )
              })}
            </div>

            {selectedCategory && (
              <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-950">
                <div className="font-semibold">About this request</div>
                <p className="mt-1">{selectedCategory.whenToUse}</p>
                <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-blue-900">Common examples</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedCategory.examples.map((example) => (
                    <span key={example} className="rounded-full bg-white px-2.5 py-1 text-xs text-blue-950 ring-1 ring-blue-100">
                      {example}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <Field label="Is this happening now?" required>
              <select value={form.happeningNow} onChange={(e) => update('happeningNow', e.target.value)} className={inputClass}>
                <option value="">Select...</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
                <option value="Not sure">Not sure</option>
              </select>
            </Field>

            <Field label="Describe the issue" required>
              <textarea
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                className={`${inputClass} min-h-[120px] resize-y`}
                placeholder={selectedCategory?.prompt ?? 'Describe what is happening so staff can review and respond.'}
              />
            </Field>

            <div>
              <span className="text-sm font-medium text-navy-900">Photos or documents</span>
              <p className="mt-0.5 text-xs text-ink-subtle">Optional. {ACCEPTED_ATTACHMENT_HINT}</p>
              {form.files.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {form.files.map((file, i) => (
                    <li key={`${file.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-ink">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{file.name}</span>
                        <span className="flex-none text-[11px] text-ink-subtle">{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                      </span>
                      <button type="button" onClick={() => removeFile(i)} className="flex-none text-xs font-medium text-ink-subtle hover:text-rose-600">
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {fileError && <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{fileError}</p>}
              <div className="mt-3">
                <input id="resident-attachment-files" type="file" multiple accept={ACCEPTED_ATTACHMENT_INPUT} className="sr-only" onChange={(e) => handleSelectFiles(e.target.files)} />
                <label htmlFor="resident-attachment-files" className="btn-secondary inline-flex cursor-pointer">
                  {form.files.length > 0 ? 'Choose different files' : 'Upload files'}
                </label>
              </div>
            </div>
          </Section>

          <Section title="Where is it?" subtitle="Give the address or nearest intersection.">
            <Field label="Type of address" required>
              <select value={form.addressType} onChange={(e) => update('addressType', e.target.value)} className={inputClass}>
                <option value="">Select...</option>
                {ADDRESS_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label={form.addressType === 'Intersection' ? 'Nearest intersection' : 'Street address'} required>
              <input
                type="text"
                value={form.location}
                onChange={(e) => update('location', e.target.value)}
                className={inputClass}
                placeholder={form.addressType === 'Intersection' ? 'Example: Main St and Queen St' : 'Example: 24 Main St N'}
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Unit or Apt" hint="optional">
                <input type="text" value={form.concernUnitNumber} onChange={(e) => update('concernUnitNumber', e.target.value)} className={inputClass} />
              </Field>
              <Field label="City" required>
                <input type="text" value={form.city} onChange={(e) => update('city', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Province" required>
                <input type="text" value={form.province} onChange={(e) => update('province', e.target.value)} className={inputClass} />
              </Field>
            </div>
            <Field label="Postal code" hint="optional">
              <input type="text" value={form.concernPostalCode} onChange={(e) => update('concernPostalCode', e.target.value)} className={inputClass} placeholder="A1A 1A1" />
            </Field>
          </Section>

          <Section title="How can we reach you?" subtitle="We will only use this to send updates on your request.">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="First name" required>
                <input type="text" value={form.firstName} onChange={(e) => update('firstName', e.target.value)} className={inputClass} autoComplete="given-name" />
              </Field>
              <Field label="Last name" required>
                <input type="text" value={form.lastName} onChange={(e) => update('lastName', e.target.value)} className={inputClass} autoComplete="family-name" />
              </Field>
              <Field label="Email" required>
                <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} className={inputClass} autoComplete="email" placeholder="you@example.com" />
              </Field>
              <Field label="Phone" hint="optional">
                <input type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} className={inputClass} autoComplete="tel" placeholder="Optional phone number" />
              </Field>
              <Field label="Method of contact" required>
                <select value={form.methodOfContact} onChange={(e) => update('methodOfContact', e.target.value)} className={inputClass}>
                  <option value="">Select...</option>
                  {METHOD_OF_CONTACT_OPTIONS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" checked={form.resolutionFollowup} onChange={(e) => update('resolutionFollowup', e.target.checked)} className="h-4 w-4" />
              Send me a follow up when my request is resolved
            </label>
            <p className="text-[11px] text-ink-subtle">{RESIDENT_DEMO_NOTICE}</p>
          </Section>

          {formError && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</div>}
          {status.kind === 'error' && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50/70 px-4 py-3 text-sm text-red-700">
              <span>{status.message}</span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <Link to="/resident" className="text-sm text-ink-muted hover:text-navy-900">Cancel</Link>
            <button type="submit" className="btn-primary" disabled={status.kind === 'submitting'}>
              {status.kind === 'submitting' ? 'Submitting...' : 'Submit request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-none rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${
        active ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-ink-muted ring-slate-200 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold text-navy-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  )
}

const inputClass =
  'mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500'

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-navy-900">
        {label}
        {required && <span className="text-rose-600"> *</span>}
        {hint && <span className="ml-1 text-xs font-normal text-ink-subtle">({hint})</span>}
      </span>
      {children}
    </label>
  )
}
