import axios from "axios";

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "",
  headers: {
    "Content-Type": "application/json",
  },
});

export async function resetSimulation(payload) {
  const { data } = await apiClient.post("/reset", payload);
  return data;
}

export async function stepSimulation(payload) {
  const { data } = await apiClient.post("/step", payload);
  return data;
}

export async function getState(task) {
  const { data } = await apiClient.get("/state", {
    params: { task },
  });
  return data;
}

export async function getTrajectory(task) {
  const { data } = await apiClient.get("/trajectory", {
    params: { task },
  });
  return data;
}

export async function getTasks() {
  const { data } = await apiClient.get("/tasks");
  return data;
}

export async function gradeSimulation(payload) {
  const { data } = await apiClient.post("/grade", payload);
  return data;
}
