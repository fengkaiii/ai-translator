const status = document.getElementById('status')
const openOptions = document.getElementById('open-options')

openOptions?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

status!.textContent = '扩展已加载'
