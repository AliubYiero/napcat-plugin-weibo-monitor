import { useEffect, useState } from 'react';
import { PAGES } from 'shared';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ToastContainer from './components/ToastContainer';
import { usePageRoute } from './hooks/usePageRoute';
import { useStatus } from './hooks/useStatus';
import { useTheme } from './hooks/useTheme';
import AccountPage from './pages/AccountPage';
import HelpPage from './pages/HelpPage';
import SessionsPage from './pages/SessionsPage';
import StatusPage from './pages/StatusPage';
import SubscriptionsPage from './pages/SubscriptionsPage';

function App() {
    const [currentPage, setCurrentPage] = usePageRoute();
    const [isScrolled, setIsScrolled] = useState(false);
    const { status, fetchStatus } = useStatus();

    useTheme();

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 5000);
        return () => clearInterval(interval);
    }, [fetchStatus]);

    const handleScroll = (e: React.UIEvent<HTMLElement>) => {
        setIsScrolled(e.currentTarget.scrollTop > 10);
    };

    const renderPage = () => {
        switch (currentPage) {
            case 'account':
                return <AccountPage />;
            case 'subscriptions':
                return <SubscriptionsPage />;
            case 'sessions':
                return <SessionsPage />;
            case 'help':
                return <HelpPage />;
            default:
                return <StatusPage status={status} />;
        }
    };

    const currentMeta =
        PAGES.find((page) => page.id === currentPage) ?? PAGES[0];

    return (
        <div className="flex h-screen overflow-hidden bg-[#f8f9fa] dark:bg-[#18191C] text-gray-800 dark:text-gray-200 transition-colors duration-300">
            <ToastContainer />
            <Sidebar
                currentPage={currentPage}
                onPageChange={setCurrentPage}
            />

            <div className="flex-1 flex flex-col overflow-hidden">
                <main
                    className="flex-1 overflow-y-auto"
                    onScroll={handleScroll}
                >
                    <Header
                        title={currentMeta.title}
                        description={currentMeta.description}
                        isScrolled={isScrolled}
                        status={status}
                    />
                    <div className="px-4 md:px-8 pb-8">
                        <div key={currentPage} className="page-enter">
                            {renderPage()}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}

export default App;
