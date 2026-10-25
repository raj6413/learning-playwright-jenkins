//This represents the consumer's API client—the code that calls the Location Service.
export async function getLocation(baseUrl: string, id: number) {
  const response = await fetch(`${baseUrl}/location/api/${id}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Location API failed: ${response.status}`);
  }

  return response.json() as Promise<{ id: number; city: string }>;
}